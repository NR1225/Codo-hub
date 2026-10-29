"""Email sending utilities using SMTP"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import (
    SMTP_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_USER,
    SMTP_PASSWORD, SMTP_FROM_NAME, RESET_PASSWORD_URL,
)

logger = logging.getLogger("codo_hub")


def send_password_reset_email(to_email: str, token: str, username: str = "") -> bool:
    """Send a password reset email with a link containing the token.

    Returns True if the email was sent successfully, False otherwise.
    """
    if not SMTP_ENABLED:
        logger.warning(
            "SMTP is disabled. Password reset token for %s: %s?token=%s",
            to_email, RESET_PASSWORD_URL, token,
        )
        return False

    reset_link = f"{RESET_PASSWORD_URL}?token={token}"
    subject = "Құпия сөзді қалпына келтіру / Восстановление пароля / Password Reset"

    html_body = _build_reset_email_html(reset_link, username)
    text_body = _build_reset_email_text(reset_link, username)

    return _send_email(to_email, subject, html_body, text_body)


def send_verification_code_email(to_email: str, code: str, username: str = "") -> bool:
    """Send a registration verification code.

    Returns True if the email was sent successfully, False otherwise.
    """
    if not SMTP_ENABLED:
        logger.warning("SMTP is disabled. Registration code for %s: %s", to_email, code)
        return False

    subject = f"{code} — Codo Hub тіркелу коды / Код подтверждения / Verification code"
    html_body = _build_code_email_html(code, username)
    text_body = _build_code_email_text(code, username)

    return _send_email(to_email, subject, html_body, text_body)


def _build_code_email_html(code: str, username: str) -> str:
    """Build HTML email body for the registration code."""
    greeting = f"Сәлем, {username}!" if username else "Сәлем!"
    return f"""\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }}
  .container {{ max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }}
  .header {{ background: #0a0a0a; padding: 30px 20px; text-align: center; }}
  .header h1 {{ color: #ffffff; margin: 0; font-size: 22px; }}
  .body {{ padding: 30px 20px; }}
  .body p {{ color: #333; font-size: 15px; line-height: 1.6; }}
  .code {{ font-family: 'Consolas', 'Courier New', monospace; font-size: 34px; font-weight: 700; letter-spacing: 10px; text-align: center; color: #0a0a0a; background: #f3f3f3; border-radius: 10px; padding: 18px 0; margin: 20px 0; }}
  .footer {{ padding: 20px; text-align: center; color: #999; font-size: 13px; border-top: 1px solid #eee; }}
  .warning {{ background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 13px; color: #e65100; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Codo Hub</h1>
  </div>
  <div class="body">
    <p>{greeting}</p>
    <p>Тіркелуді аяқтау үшін осы кодты енгізіңіз:<br>
       Введите этот код, чтобы завершить регистрацию:<br>
       Enter this code to finish signing up:</p>
    <div class="code">{code}</div>
    <p>Егер тіркелмеген болсаңыз, бұл хатты елемеуіңізге болады. /
       Если вы не регистрировались, проигнорируйте это письмо. /
       If you did not sign up, you can safely ignore this email.</p>
    <div class="warning">
      ⏰ Код 10 минут ішінде жарамды. / Код действителен 10 минут. / The code expires in 10 minutes.
    </div>
  </div>
  <div class="footer">
    <p>© Codo Hub — kazakhhub.com</p>
  </div>
</div>
</body>
</html>"""


def _build_code_email_text(code: str, username: str) -> str:
    """Build plain text email body for the registration code."""
    greeting = f"Сәлем, {username}!" if username else "Сәлем!"
    return f"""\
{greeting}

Тіркелу коды / Код подтверждения / Verification code:

    {code}

Код 10 минут ішінде жарамды. / Код действителен 10 минут. / The code expires in 10 minutes.

— Codo Hub
"""


def _build_reset_email_html(reset_link: str, username: str) -> str:
    """Build HTML email body for password reset."""
    greeting = f"Сәлем, {username}!" if username else "Сәлем!"
    return f"""\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }}
  .container {{ max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }}
  .header {{ background: linear-gradient(135deg, #1a73e8, #0d47a1); padding: 30px 20px; text-align: center; }}
  .header h1 {{ color: #ffffff; margin: 0; font-size: 22px; }}
  .body {{ padding: 30px 20px; }}
  .body p {{ color: #333; font-size: 15px; line-height: 1.6; }}
  .btn {{ display: inline-block; background: linear-gradient(135deg, #1a73e8, #0d47a1); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; margin: 16px 0; }}
  .footer {{ padding: 20px; text-align: center; color: #999; font-size: 13px; border-top: 1px solid #eee; }}
  .warning {{ background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 13px; color: #e65100; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Codo Hub</h1>
  </div>
  <div class="body">
    <p>{greeting}</p>
    <p>Сіздің аккаунтыңыз үшін құпия сөзді қалпына келтіру сұрауы келіп түсті. Төмендегі батырманы басып, жаңа құпия сөз орнатыңыз:</p>
    <p style="text-align: center;">
      <a href="{reset_link}" class="btn">Құпия сөзді өзгерту</a>
    </p>
    <p>Егер сұрау жібермеген болсаңыз, бұл хатты елемеуіңізге болады.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p>Поступил запрос на сброс пароля для вашей учётной записи. Нажмите кнопку ниже, чтобы задать новый пароль:</p>
    <p style="text-align: center;">
      <a href="{reset_link}" class="btn">Сбросить пароль</a>
    </p>
    <p>Если вы не запрашивали сброс, просто проигнорируйте это письмо.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p>A password reset was requested for your account. Click the button below to set a new password:</p>
    <p style="text-align: center;">
      <a href="{reset_link}" class="btn">Reset Password</a>
    </p>
    <p>If you did not request this, you can safely ignore this email.</p>
    <div class="warning">
      ⏰ Бұл сілтеме 1 сағат ішінде жарамды. / Ссылка действительна 1 час. / This link expires in 1 hour.
    </div>
  </div>
  <div class="footer">
    <p>© Codo Hub — kazakhhub.com</p>
  </div>
</div>
</body>
</html>"""


def _build_reset_email_text(reset_link: str, username: str) -> str:
    """Build plain text email body for password reset."""
    greeting = f"Сәлем, {username}!" if username else "Сәлем!"
    return f"""\
{greeting}

Құпия сөзді қалпына келтіру үшін сілтемеге өтіңіз:
{reset_link}

Бұл сілтеме 1 сағат ішінде жарамды.

---

Для сброса пароля перейдите по ссылке:
{reset_link}

Ссылка действительна 1 час.

---

To reset your password, visit:
{reset_link}

This link expires in 1 hour.

— Codo Hub
"""


def _send_email(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> bool:
    """Send an email via SMTP.

    Returns True on success, False on failure.
    """
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to_email, msg.as_string())

        logger.info("Email sent to %s", to_email)
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD.")
        return False
    except smtplib.SMTPConnectError:
        logger.error("Could not connect to SMTP server %s:%s", SMTP_HOST, SMTP_PORT)
        return False
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False