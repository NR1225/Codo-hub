"""User-related Pydantic models"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from utils.validators import validate_email


class UserRegister(BaseModel):
    username: str = Field(min_length=2, max_length=50, pattern=r'^[a-zA-Z0-9_Ѐ-ӿ]+$')
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return validate_email(v)


class UserLogin(BaseModel):
    email: Optional[str] = Field(default=None, max_length=255)
    username: Optional[str] = Field(default=None, max_length=50)
    password: str = Field(max_length=128)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        if v is not None:
            return validate_email(v)
        return v


class ChangePassword(BaseModel):
    currentPassword: str = Field(max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=2, max_length=50, pattern=r'^[a-zA-Z0-9_Ѐ-ӿ]+$')
    email: Optional[str] = Field(default=None, max_length=255)
    avatar: Optional[str] = Field(default=None, max_length=1_500_000)  # ~1MB base64
    bio: Optional[str] = Field(default=None, max_length=500)
    userId: Optional[str] = Field(default=None, max_length=50)
    currentEmail: Optional[str] = Field(default=None, max_length=255)

    @field_validator('email', 'currentEmail')
    @classmethod
    def validate_email(cls, v):
        if v is not None:
            return validate_email(v)
        return v


class ForgotPasswordRequest(BaseModel):
    email: str = Field(max_length=255)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return validate_email(v)


class ResetPasswordRequest(BaseModel):
    token: str = Field(max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


class TwoFASetupVerify(BaseModel):
    code: str = Field(max_length=6, pattern=r'^\d{6}$')


class TwoFADisable(BaseModel):
    password: str = Field(max_length=128)


class TwoFALoginVerify(BaseModel):
    temp_token: str = Field(max_length=500)
    code: str = Field(max_length=6, pattern=r'^\d{6}$')