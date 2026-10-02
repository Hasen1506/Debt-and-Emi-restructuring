import pytest
from api.auth.email import send_otp_email


def test_missing_email_provider_never_claims_success_or_logs_a_production_code(monkeypatch, capsys):
    monkeypatch.delenv('RESEND_API_KEY', raising=False)
    monkeypatch.delenv('OTP_DEV_MODE', raising=False)
    with pytest.raises(RuntimeError):
        send_otp_email('test@example.com', '123456')
    assert '123456' not in capsys.readouterr().out


def test_local_code_delivery_requires_explicit_development_mode(monkeypatch, capsys):
    monkeypatch.delenv('RESEND_API_KEY', raising=False)
    monkeypatch.setenv('OTP_DEV_MODE', 'true')
    send_otp_email('test@example.com', '123456')
    assert '123456' in capsys.readouterr().out
