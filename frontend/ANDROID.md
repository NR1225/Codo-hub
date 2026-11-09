# Codo Hub — Android қосымшасы

Android нұсқасы [Capacitor](https://capacitorjs.com) арқылы жасалған: бар React фронтенд
нативті Android WebView ішінде іске қосылады. Android Studio жобасы — `frontend/android/`.

## Командалар (`frontend/` ішінде)

| Команда | Не істейді |
|---|---|
| `npm run cap:sync` | Вебті Android режимінде құрастырып, `android/` ішіне көшіреді |
| `npm run android:open` | Жобаны Android Studio-да ашады |
| `npm run android:apk` | Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:release` | Google Play үшін AAB (алдымен қол қою кілтін баптаңыз) |

Код өзгерген сайын: `npm run cap:sync`, содан кейін Android Studio-да ▶ Run.

## Баптаулар

- `.env.android` — қосымша қай бэкендке қосылатыны (`VITE_API_BASE_URL`) және бөлісу
  сілтемелерінің домені (`VITE_SITE_URL`).
- `capacitor.config.ts` — `appId` (`com.codohub.app`), атауы, splash.
- Бэкенд `https://localhost` origin-ін (Capacitor WebView) CORS-та автоматты рұқсат етеді
  (`backend/main.py`). Продакшнда күшіне енуі үшін бэкендті қайта деплой етіңіз.
- Иконка/splash: `assets/` ішіндегі суреттерді ауыстырып,
  `npx @capacitor/assets generate --android` іске қосыңыз.

## Google Play-ге шығару

1. Android Studio → *Build → Generate Signed App Bundle / APK* → жаңа keystore жасаңыз
   (keystore-ды жоғалтпаңыз, git-ке қоспаңыз).
2. `android/app/build.gradle` ішінде `versionCode`/`versionName` өсіріңіз.
3. Дайын `.aab` файлын Play Console-ға жүктеңіз.
