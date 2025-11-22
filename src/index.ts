import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { PersonalityStore } from './personalityStore';
import { DeepSeekClient } from './deepseekClient';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_TOKEN = process.env.OPENROUTER_TOKEN || process.env.DEEPSEEK_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.openrouter.ai';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-large';
const SQLITE_FILE = process.env.SQLITE_FILE || './data/kaonasi.sqlite.bin';
const DEFAULT_PERSONA_NAME = process.env.DEFAULT_PERSONA || 'Kaonasi';

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const store = new PersonalityStore(SQLITE_FILE);
const deepseek = new DeepSeekClient({ apiKey: OPENROUTER_TOKEN, baseUrl: OPENROUTER_BASE_URL, modelName: OPENROUTER_MODEL });

(async () => {
  await store.init();

  // pending replies for /talk via UI: userId -> { personaId, replyTo }
  const pendingReplies = new Map<number, { personaId: string; replyTo: number }>();

  function keywordRelevance(persona: { keywords: string[] }, text: string) {
    if (!persona.keywords || persona.keywords.length === 0) return 0;
    const t = text.toLowerCase();
    let score = 0;
    for (const kw of persona.keywords) {
      if (!kw) continue;
      if (t.includes(kw.toLowerCase())) score += 1;
    }
    return score / persona.keywords.length;
  }

  bot.start(ctx => ctx.reply('Привет! Мультиличностный бот готов. /help'));

  bot.command('help', ctx => {
    ctx.reply(
        '/list - показать личности\n' +
        '/add name|prompt|kw1,kw2 - добавить личность (если не указаны ключевые слова, попробуем сгенерировать через OpenRouter)\\n' +
        '/talk name|message - обратиться к личности\n' +
        '/talk - выбрать личность из списка\n' +
        '/clear name - очистить память личности\n' +
        'Можно писать "Name: сообщение" или упоминать бота @bot'
    );
  });

  bot.command('list', async ctx => {
    const personas = await store.list();
    if (personas.length === 0) return ctx.reply('Пока нет личностей. Добавьте /add');
    const lines = personas.map(p => `- ${p.name} (keywords: ${p.keywords.join(', ')})`);
    ctx.reply(lines.join('\n'));
  });

  bot.command('add', async ctx => {
    const payload = ctx.message.text.replace(/^\/add(\s+|$)/, '').trim();
    if (!payload) return ctx.reply('Использование: /add name|prompt|kw1,kw2 (kw опционально)');
    const [name, prompt, kws] = payload.split('|').map(s => s?.trim());
    if (!name || !prompt) return ctx.reply('Нужно указать name и prompt: /add name|prompt|kw1,kw2');

    let keywords: string[] = [];
    if (kws && kws.trim().length > 0) {
      keywords = kws.split(',').map(s => s.trim()).filter(Boolean);
    } else if (OPENROUTER_TOKEN && OPENROUTER_BASE_URL) {
      try {
        await ctx.replyWithChatAction('typing');
        const extracted = await deepseek.extractKeywords(prompt, 12);
        if (Array.isArray(extracted) && extracted.length > 0) {
          keywords = extracted.map(k => String(k).trim()).filter(Boolean);
          ctx.reply(`Сгенерированы ключевые слова через OpenRouter: ${keywords.join(', ')}`);
        } else {
          ctx.reply('OpenRouter не вернул ключевые слова, создаю личность без ключевых слов.');
        }
      } catch (e: any) {
        console.warn('extractKeywords failed:', e?.message || e);
        ctx.reply('Не удалось сгенерировать ключевые слова через OpenRouter — добавляю личность без них (или укажите вручную).');
      }
    } else {
      ctx.reply('Ключевые слова не указаны и OpenRouter не настроен — личность будет добавлена без ключевых слов.');
    }

    try {
      await store.add(name, prompt, keywords);
      ctx.reply(`Личность "${name}" добавлена. keywords: ${keywords.join(', ')}`);
    } catch (e: any) {
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command('clear', async ctx => {
    const payload = ctx.message.text.replace(/^\/clear(\s+|$)/, '').trim();
    if (!payload) return ctx.reply('Использование: /clear name');
    try {
      await store.clearMemory(payload);
      ctx.reply(`Память "${payload}" очищена.`);
    } catch (e: any) {
      ctx.reply(`Ошибка: ${e.message}`);
    }
  });

  bot.command('talk', async ctx => {
    const payload = ctx.message.text.replace(/^\/talk(\s+|$)/, '').trim();
    if (!payload) {
      // show UI list of personas as inline keyboard
      const personas = await store.list();
      if (personas.length === 0) return ctx.reply('Нет личностей для выбора. Добавьте через /add');
      const buttons: any[] = [];
      for (let i = 0; i < personas.length; i += 3) {
        buttons.push(personas.slice(i, i + 3).map(p => ({ text: p.name, callback_data: `select_persona:${p.id}` })));
      }
      return ctx.reply('Выберите личность, чтобы отправить сообщение:', { reply_markup: { inline_keyboard: buttons } });
    }

    const [name, ...rest] = payload.split('|');
    const message = rest.join('|').trim();
    if (!name || !message) return ctx.reply('Использование: /talk name|message');
    const persona = await store.getByName(name.trim());
    if (!persona) return ctx.reply('Личность не найдена.');
    await ctx.replyWithChatAction('typing');
    try {
      const reply = await generatePersonaReply(persona, message);
      await store.appendMemory(persona.id, { role: 'user', text: message, ts: new Date().toISOString() });
      await store.appendMemory(persona.id, { role: 'bot', text: reply, ts: new Date().toISOString() });
      ctx.reply(`(${persona.name}): ${reply}`);
    } catch (e: any) {
      ctx.reply(`Ошибка генерации: ${e.message}`);
    }
  });

  bot.on('callback_query', async ctx => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('select_persona:')) return ctx.answerCbQuery();
    const personaId = data.replace('select_persona:', '');
    const persona = (await store.list()).find(p => p.id === personaId);
    if (!persona) return ctx.answerCbQuery('Persona not found', { show_alert: true });

    await ctx.answerCbQuery();
    try {
      const sent = await ctx.reply(`Напишите сообщение для ${persona.name}`, { reply_markup: { force_reply: true } });
      const userId = ctx.from?.id as number;
      pendingReplies.set(userId, { personaId: persona.id, replyTo: sent.message_id });
      setTimeout(() => {
        const p = pendingReplies.get(userId);
        if (p && p.replyTo === sent.message_id) pendingReplies.delete(userId);
      }, 2 * 60 * 1000);
    } catch (e: any) {
      try {
        const userId = ctx.from?.id as number;
        const sent = await ctx.telegram.sendMessage(userId, `Напишите сообщение для ${persona.name}`, { reply_markup: { force_reply: true } });
        pendingReplies.set(userId, { personaId: persona.id, replyTo: sent.message_id });
        setTimeout(() => {
          const p = pendingReplies.get(userId);
          if (p && p.replyTo === sent.message_id) pendingReplies.delete(userId);
        }, 2 * 60 * 1000);
        ctx.reply('Отправил вам личное сообщение, напишите ответ там.');
      } catch (err) {
        console.error('Failed to ask for message:', err);
        ctx.reply('Не удалось запросить сообщение.');
      }
    }
  });

  bot.on('text', async ctx => {
    const text = ctx.message.text;
    const from = ctx.message.from?.username || ctx.message.from?.first_name || 'user';
    if (text.startsWith('/')) return;

    const userId = ctx.message.from?.id as number;
    const pending = pendingReplies.get(userId);
    if (pending && ctx.message.reply_to_message && ctx.message.reply_to_message.message_id === pending.replyTo) {
      const persona = (await store.list()).find(p => p.id === pending.personaId);
      pendingReplies.delete(userId);
      if (!persona) return ctx.reply('Личность уже удалена.');
      const userMessage = ctx.message.text;
      await ctx.replyWithChatAction('typing');
      try {
        const reply = await generatePersonaReply(persona, userMessage);
        await store.appendMemory(persona.id, { role: 'user', text: userMessage, ts: new Date().toISOString() });
        await store.appendMemory(persona.id, { role: 'bot', text: reply, ts: new Date().toISOString() });
        return ctx.reply(`(${persona.name}): ${reply}`);
      } catch (e: any) {
        return ctx.reply(`Ошибка: ${e.message}`);
      }
    }

    const personas = await store.list();
    if (personas.length === 0) return;

    const botName = (ctx.botInfo && ctx.botInfo.username) || '';
    const botMentioned = botName && text.includes(`@${botName}`);

    const directMatch = text.match(/^([^:\n]+):\s*(.+)/);
    if (directMatch) {
      const name = directMatch[1].trim();
      const msg = directMatch[2].trim();
      const persona = await store.getByName(name);
      if (persona) {
        await ctx.replyWithChatAction('typing');
        try {
          const reply = await generatePersonaReply(persona, msg);
          await store.appendMemory(persona.id, { role: 'user', text: msg, ts: new Date().toISOString() });
          await store.appendMemory(persona.id, { role: 'bot', text: reply, ts: new Date().toISOString() });
          return ctx.reply(`(${persona.name}): ${reply}`);
        } catch (e: any) {
          return ctx.reply(`Ошибка: ${e.message}`);
        }
      }
    }

    if (botMentioned) {
      const persona = (await store.getByName(DEFAULT_PERSONA_NAME)) || personas[0];
      await ctx.replyWithChatAction('typing');
      try {
        const reply = await generatePersonaReply(persona, text);
        await store.appendMemory(persona.id, { role: 'user', text, ts: new Date().toISOString() });
        await store.appendMemory(persona.id, { role: 'bot', text: reply, ts: new Date().toISOString() });
        return ctx.reply(`(${persona.name}): ${reply}`);
      } catch (e: any) {
        return ctx.reply(`Ошибка: ${e.message}`);
      }
    }

    const relevancePromises = personas.map(async p => {
      const dsScore = await deepseek.relevanceScore(p, text);
      if (dsScore !== null) return { persona: p, score: dsScore };
      const kwScore = keywordRelevance(p, text);
      return { persona: p, score: kwScore };
    });

    const scores = await Promise.all(relevancePromises);
    const main = scores.find(s => s.score >= 0.6);
    const others = scores.filter(s => s.score >= 0.4 && (!main || s.persona.id !== main.persona.id));

    if (main) {
      await ctx.replyWithChatAction('typing');
      try {
        const reply = await generatePersonaReply(main.persona, text);
        await store.appendMemory(main.persona.id, { role: 'user', text, ts: new Date().toISOString() });
        await store.appendMemory(main.persona.id, { role: 'bot', text: reply, ts: new Date().toISOString() });
        await ctx.reply(`(${main.persona.name}): ${reply}`);
      } catch (e: any) {
        await ctx.reply(`Ошибка: ${e.message}`);
      }
    }

    for (const o of others.slice(0, 2)) {
      setTimeout(async () => {
        try {
          const shortReply = await generatePersonaReply(o.persona, text, { short: true });
          await store.appendMemory(o.persona.id, { role: 'user', text, ts: new Date().toISOString() });
          await store.appendMemory(o.persona.id, { role: 'bot', text: shortReply, ts: new Date().toISOString() });
          await ctx.reply(`(${o.persona.name}): ${shortReply}`);
        } catch {
          // ignore
        }
      }, 1500);
    }
  });

  async function generatePersonaReply(persona: any, userMessage: string, opts: { short?: boolean } = {}): Promise<string> {
    const memory = persona.memory || (await store.getMemory(persona.id, 50));
    if (OPENROUTER_TOKEN && OPENROUTER_BASE_URL) {
      try {
        const reply = await deepseek.generateReply(persona, userMessage, memory);
        return reply;
      } catch (e: any) {
        console.warn('OpenRouter/DeepSeek failed, fallback:', e.message);
      }
    }
    if (opts.short) return 'Интересно.';
    return `${persona.prompt} — Я заметил: "${userMessage}". Что думаешь?`;
  }

  bot.launch().then(() => console.log('Bot started')).catch(err => console.error('Start error', err));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();