# 1Fit slot watcher → Telegram

## Запуск
```bash
pip install requests
export TG_TOKEN=...        # от @BotFather
export TG_CHAT_ID=...      # твой chat id (напиши @userinfobot)
export ONEFIT_TOKEN=...    # токен ВТОРОГО аккаунта 1Fit
export ONEFIT_BASE=...     # базовый адрес API из перехвата
python bot.py
```
Проверка без 1Fit: `ONEFIT_FAKE=1 python bot.py`.

## Как достать запрос 1Fit (один раз)
1. Если у 1Fit есть веб-версия с расписанием: открой в Chrome, F12 → Network → Fetch/XHR,
   открой нужный зал и дату → правой кнопкой по запросу с расписанием → Copy as cURL.
2. Если только приложение: перехвати трафик телефона через HTTP Toolkit / mitmproxy / Proxyman (iOS).
   Нужны: запрос поиска заведений и запрос расписания зала на дату (+ пример JSON-ответа).
3. Впиши адреса и разбор ответа в `onefit.py` (места помечены TODO).
