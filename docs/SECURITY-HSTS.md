# HSTS (HTTP Strict Transport Security)

> Қысқаша: HSTS — браузерге «бұл сайтқа **тек HTTPS**-пен кір» деп айтатын жауап тақырыбы.
> Жергілікті дамуда (`http://localhost`) қажет емес әрі зиянды. Тек прод/HTTPS-те қосылады.

## HSTS деген не және не үшін керек

`Strict-Transport-Security` тақырыбын сервер HTTPS жауабымен жібергенде, браузер есіне сақтайды:
«келесі N секунд ішінде осы доменге **әрқашан HTTPS**-пен бар, http-ге рұқсат жоқ».

Қорғайтын шабуыл — **SSL stripping / downgrade**: шабуылшы (Wi-Fi, прокси) қолданушыны
`https://` орнына `http://`-ке қайтарып, трафикті оқуға/өзгертуге тырысады. HSTS-пен браузер
http-ге мүлде шықпайды, сондықтан токен/құпиясөз ашық кетпейді.

## Қазіргі жағдай: код дайын

`backend/main.py` → `SecurityHeadersMiddleware` HSTS-ті **тек HTTPS сұранысында** жібереді
(`X-Forwarded-Proto: https` немесе тікелей https):

```python
proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
if proto == "https":
    hsts = f"max-age={HSTS_MAX_AGE}"
    if HSTS_INCLUDE_SUBDOMAINS:
        hsts += "; includeSubDomains"
    response.headers["Strict-Transport-Security"] = hsts
```

Баптау (`backend/.env`):

| Айнымалы | Әдепкі | Түсінік |
|---|---|---|
| `HSTS_MAX_AGE` | `86400` (1 күн) | Тексергеннен кейін `31536000`-ға көтеріңіз. |
| `HSTS_INCLUDE_SUBDOMAINS` | `false` | Барлық субдомен HTTPS болса ғана `true`. |

- **Жергілікті `http://localhost`:** тақырып жіберілмейді, дамуға әсері жоқ.
- **Cloud Run:** Google фронтенді `X-Forwarded-Proto: https` қояды, сондықтан тақырып
  автоматты түрде қосылады.
- `preload` әдейі қосылмаған — оны қайтару қиын.

## Балама: TLS аяқталатын жерде

Алдыңда Nginx / Load Balancer болса, HSTS-ті сонда да қоюға болады (екеуін бірдей
қоймаңыз — бір ғана көз болсын):

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

## Параметрлерді таңдау

| Параметр | Мән | Түсінік |
|---|---|---|
| `max-age` | `31536000` (1 жыл) | Браузер есте сақтайтын уақыт. Алдымен кіші (мыс. `86400`) қойып, сосын ұлғайтыңыз. |
| `includeSubDomains` | опция | Барлық субдомендер **де** HTTPS болуға тиіс болса ғана. |
| `preload` | опция | Браузердің HSTS preload тізіміне кіру. **Қайтару қиын** — тек бәрі тұрақты HTTPS болғанда. |

## Қадамдар (контрольдік тізім)

1. [ ] Прод толықтай HTTPS болсын (http → https редирект).
2. [ ] Кіші `max-age` (1 күн) қойып, бәрі жұмыс істейтінін тексер.
3. [ ] `max-age`-ті 1 жылға ұлғайт.
4. [ ] Барлық субдомен HTTPS болса — `includeSubDomains` қос.
5. [ ] Тұрақты болғанда ғана `preload` ойлан (https://hstspreload.org).

## Қорытынды

- **Код:** дайын, тек HTTPS-те жұмыс істейді, env арқылы басқарылады.
- **Прод-та қалғаны:** `HSTS_MAX_AGE`-ті кезеңмен 1 жылға көтеру, субдомендер
  шешімі, қаласаңыз `preload`.
