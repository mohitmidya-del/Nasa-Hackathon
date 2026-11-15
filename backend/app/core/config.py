from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    # Neon connection string, e.g.:
    # postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
    database_url: str = "postgresql://neondb_owner:npg_Tdc6BpCoH3XW@ep-steep-moon-bda2u9hv-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,nasa2k26.vercel.app"
    jwt_secret_key: str = "change-this-ares-super-secret-jwt-key-in-prod"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24 hours

    @property
    def sqlalchemy_database_url(self) -> str:
        url = self.database_url.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and "+psycopg" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)

        # Neon requires SSL; enforce sslmode=require for Neon hosts if missing
        if "neon.tech" in url and "sslmode=" not in url:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}sslmode=require"
        return url

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()