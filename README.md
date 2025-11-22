```markdown
# Kaonasi Funny Bot — DeepSeek + SQLite (TypeScript)

Что реализовано:
- Телеграм-бот (Telegraf) с поддержкой множества личностей (personas).
- Хранилище на SQLite (better-sqlite3). Таблицы personas и memory с автоматической миграцией.
- Интеграция с DeepSeek через axios. Путь к эндпоинтам configurable через переменные окружения.
- Команды: /add, /list, /talk, /clear, /help.
- Поддержка: "Name: сообщение", упоминание бота @bot, автоматические подхваты нескольких личностей по релевантности.

Переменные окружения (см .env.example):
- TELEGRAM_BOT_TOKEN — обязательный
- DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL — для DeepSeek (опционально)
- DEEPSEEK_GENERATE_PATH, DEEPSEEK_RELEVANCE_PATH — можно настроить кастомные пути
- SQLITE_FILE — путь к файлу базы (по умолчанию ./data/kaonasi.db)

Как запустить:
1. Скопировать файлы в проект.
2. npm install (в package.json добавлены axios и better-sqlite3)
3. Создать `.env` по примеру и заполнить TELEGRAM_BOT_TOKEN (и DeepSeek, если нужно).
4. npm run dev (или собрать и запустить).

Дальнейшее развитие:
- Настроить более аккуратный prompt engineering (система + persona + history).
- Поддержать admin UI для управления личностями.
- Ограничить спам: rate limit на ответы вторичных персон.
- Тесты и CI.

```