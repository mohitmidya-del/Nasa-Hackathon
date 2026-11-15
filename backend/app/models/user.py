from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    callsign: Mapped[str] = mapped_column(String(64), default="ARES-CREW-1", nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="astronaut", nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    traverses: Mapped[list["UserTraverseHistory"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserSession(Base):
    """Persists user login sessions & revocation status in Neon PostgreSQL."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    logged_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    logged_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    user: Mapped["User"] = relationship(back_populates="sessions")

    __table_args__ = (
        Index("ix_user_sessions_user_active", "user_id", "is_active"),
    )


class UserTraverseHistory(Base):
    """Indexed past traverse history for a user, including bounding-box spatial indexes."""

    __tablename__ = "user_traverse_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    mission_id: Mapped[str] = mapped_column(String(64), nullable=False)
    route_name: Mapped[str] = mapped_column(String(128), default="Unnamed Traverse", nullable=False)
    route_mode: Mapped[str] = mapped_column(String(24), default="safe", nullable=False)  # safe | direct | science
    decision: Mapped[str] = mapped_column(String(16), default="GO", nullable=False)  # GO | CAUTION | NO-GO

    start_lat: Mapped[float] = mapped_column(Float, nullable=False)
    start_lon: Mapped[float] = mapped_column(Float, nullable=False)
    end_lat: Mapped[float] = mapped_column(Float, nullable=False)
    end_lon: Mapped[float] = mapped_column(Float, nullable=False)

    # Bounding-box columns for fast indexed corridor queries
    min_lat: Mapped[float] = mapped_column(Float, nullable=False)
    max_lat: Mapped[float] = mapped_column(Float, nullable=False)
    min_lon: Mapped[float] = mapped_column(Float, nullable=False)
    max_lon: Mapped[float] = mapped_column(Float, nullable=False)

    distance_km: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    estimated_time_min: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_slope_deg: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    safety_score: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    o2_used_liters: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    waypoints: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="traverses")
    nearby_hazards: Mapped[list["TraversePathHazard"]] = relationship(
        back_populates="traverse", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_traverse_user_created", "user_id", "created_at"),
        Index("ix_traverse_user_mission_mode", "user_id", "mission_id", "route_mode"),
        Index("ix_traverse_geo_bbox", "min_lat", "max_lat", "min_lon", "max_lon"),
    )


class TraversePathHazard(Base):
    """Indexed hazards located near a user's past traverse paths."""

    __tablename__ = "traverse_path_hazards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    traverse_id: Mapped[int] = mapped_column(
        ForeignKey("user_traverse_history.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    hazard_name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="terrain", nullable=False)  # volcano | canyon | chaos | slope | reported
    severity: Mapped[int] = mapped_column(Integer, default=3, nullable=False)  # 1..5
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    distance_from_path_km: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    traverse: Mapped["UserTraverseHistory"] = relationship(back_populates="nearby_hazards")

    __table_args__ = (
        Index("ix_path_hazard_user_geo", "user_id", "lat", "lon"),
        Index("ix_path_hazard_traverse_dist", "traverse_id", "distance_from_path_km"),
        Index("ix_path_hazard_category_sev", "category", "severity"),
    )