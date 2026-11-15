from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.routes import api_router
from app.core.config import get_settings
from app.core.database import Base, engine
from app.models import Hazard, Mission, RouteAnalysis, TelemetrySample  # noqa: F401
from app.models.user import (  # noqa: F401
    TraversePathHazard,
    User,
    UserSession,
    UserTraverseHistory,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="ARES Mission Backend",
    description="Autonomous EVA Routing & Environmental Safety System (Neon PostgreSQL + Vercel).",
    version="1.1.0",
    lifespan=lifespan,
)

cors_origins = settings.origins if settings.environment == "production" else (settings.origins + ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(api_router, prefix="/api")


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "online", "service": "ARES Mission Backend", "db": "neon-postgres"}