from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.security import (
    bearer_scheme,
    create_access_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models.user import TraversePathHazard, User, UserSession, UserTraverseHistory

router = APIRouter(prefix="/auth", tags=["Auth & User Traverse History"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    callsign: str = Field(default="ARES-CREW-1", max_length=64)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    session_id: int
    user: dict


class PathHazardIn(BaseModel):
    hazard_name: str
    category: str = "terrain"
    severity: int = Field(default=3, ge=1, le=5)
    lat: float
    lon: float
    distance_from_path_km: float = 0.0
    detail: str | None = None


class TraverseHistoryCreate(BaseModel):
    mission_id: str
    route_name: str = "EVA Traverse"
    route_mode: str = "safe"
    decision: str = "GO"
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    distance_km: float
    estimated_time_min: int = 0
    max_slope_deg: float = 0.0
    safety_score: float = 100.0
    o2_used_liters: float = 0.0
    waypoints: list[dict] = Field(default_factory=list)
    nearby_hazards: list[PathHazardIn] = Field(default_factory=list)


def _create_login_session(user: User, request: Request, db: Session) -> tuple[str, datetime, int]:
    now = datetime.now(timezone.utc)
    token, jti, expires_at = create_access_token(
        subject=user.username, extra_claims={"role": user.role, "uid": user.id}
    )
    user.last_login_at = now
    session = UserSession(
        user_id=user.id,
        jti=jti,
        ip_address=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:255],
        is_active=True,
        logged_in_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, expires_at, session.id


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    username = payload.username.strip()
    email = payload.email.lower().strip()

    existing = (
        db.query(User)
        .filter(or_(User.username == username, User.email == email))
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already registered",
        )

    user = User(
        username=username,
        email=email,
        callsign=payload.callsign.strip() or "ARES-CREW-1",
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token, expires_at, session_id = _create_login_session(user, request, db)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "session_id": session_id,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "callsign": user.callsign,
            "role": user.role,
        },
    }


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    identifier = payload.username.strip()
    user = (
        db.query(User)
        .filter(or_(User.username == identifier, User.email == identifier.lower()))
        .first()
    )
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token, expires_at, session_id = _create_login_session(user, request, db)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "session_id": session_id,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "callsign": user.callsign,
            "role": user.role,
        },
    }


@router.post("/logout")
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    payload = decode_token(credentials.credentials)
    jti = payload["jti"]

    session = db.query(UserSession).filter(UserSession.jti == jti).first()
    if session and session.is_active:
        session.is_active = False
        session.logged_out_at = now
        db.commit()

    return {"status": "logged_out", "username": current_user.username}


@router.post("/logout-all")
def logout_all_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    updated = (
        db.query(UserSession)
        .filter(UserSession.user_id == current_user.id, UserSession.is_active.is_(True))
        .update({"is_active": False, "logged_out_at": now}, synchronize_session=False)
    )
    db.commit()
    return {"status": "all_sessions_revoked", "revoked_count": updated}


@router.get("/me")
def read_current_user(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "callsign": current_user.callsign,
        "role": current_user.role,
        "last_login_at": current_user.last_login_at,
    }


@router.get("/sessions")
def list_user_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == current_user.id)
        .order_by(UserSession.logged_in_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": s.id,
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "is_active": s.is_active,
            "logged_in_at": s.logged_in_at,
            "logged_out_at": s.logged_out_at,
            "expires_at": s.expires_at,
        }
        for s in sessions
    ]


@router.post("/traverses", status_code=status.HTTP_201_CREATED)
def record_user_traverse(
    payload: TraverseHistoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lats = [payload.start_lat, payload.end_lat] + [
        w["lat"] for w in payload.waypoints if isinstance(w, dict) and "lat" in w
    ]
    lons = [payload.start_lon, payload.end_lon] + [
        w["lon"] for w in payload.waypoints if isinstance(w, dict) and "lon" in w
    ]

    traverse = UserTraverseHistory(
        user_id=current_user.id,
        mission_id=payload.mission_id,
        route_name=payload.route_name,
        route_mode=payload.route_mode,
        decision=payload.decision,
        start_lat=payload.start_lat,
        start_lon=payload.start_lon,
        end_lat=payload.end_lat,
        end_lon=payload.end_lon,
        min_lat=min(lats),
        max_lat=max(lats),
        min_lon=min(lons),
        max_lon=max(lons),
        distance_km=payload.distance_km,
        estimated_time_min=payload.estimated_time_min,
        max_slope_deg=payload.max_slope_deg,
        safety_score=payload.safety_score,
        o2_used_liters=payload.o2_used_liters,
        waypoints=payload.waypoints,
    )
    db.add(traverse)
    db.flush()

    for hz in payload.nearby_hazards:
        db.add(
            TraversePathHazard(
                traverse_id=traverse.id,
                user_id=current_user.id,
                hazard_name=hz.hazard_name,
                category=hz.category,
                severity=hz.severity,
                lat=hz.lat,
                lon=hz.lon,
                distance_from_path_km=hz.distance_from_path_km,
                detail=hz.detail,
            )
        )

    db.commit()
    db.refresh(traverse)
    return {"id": traverse.id, "status": "recorded", "hazards_indexed": len(payload.nearby_hazards)}


@router.get("/traverses")
def get_user_traverses_and_hazards(
    mission_id: str | None = Query(default=None),
    route_mode: str | None = Query(default=None),
    lat: float | None = Query(default=None),
    lon: float | None = Query(default=None),
    radius_deg: float = Query(default=2.0, gt=0, le=90),
    limit: int = Query(default=25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Uses composite & spatial bounding-box indexes to fetch user traverse history and nearby hazards."""
    query = (
        db.query(UserTraverseHistory)
        .options(selectinload(UserTraverseHistory.nearby_hazards))
        .filter(UserTraverseHistory.user_id == current_user.id)
    )
    if mission_id:
        query = query.filter(UserTraverseHistory.mission_id == mission_id)
    if route_mode:
        query = query.filter(UserTraverseHistory.route_mode == route_mode)
    if lat is not None and lon is not None:
        query = query.filter(
            UserTraverseHistory.min_lat <= lat + radius_deg,
            UserTraverseHistory.max_lat >= lat - radius_deg,
            UserTraverseHistory.min_lon <= lon + radius_deg,
            UserTraverseHistory.max_lon >= lon - radius_deg,
        )

    rows = query.order_by(UserTraverseHistory.created_at.desc()).limit(limit).all()

    return [
        {
            "id": t.id,
            "mission_id": t.mission_id,
            "route_name": t.route_name,
            "route_mode": t.route_mode,
            "decision": t.decision,
            "start": {"lat": t.start_lat, "lon": t.start_lon},
            "end": {"lat": t.end_lat, "lon": t.end_lon},
            "bbox": {
                "min_lat": t.min_lat,
                "max_lat": t.max_lat,
                "min_lon": t.min_lon,
                "max_lon": t.max_lon,
            },
            "distance_km": t.distance_km,
            "estimated_time_min": t.estimated_time_min,
            "max_slope_deg": t.max_slope_deg,
            "safety_score": t.safety_score,
            "o2_used_liters": t.o2_used_liters,
            "created_at": t.created_at,
            "nearby_hazards": [
                {
                    "id": h.id,
                    "hazard_name": h.hazard_name,
                    "category": h.category,
                    "severity": h.severity,
                    "lat": h.lat,
                    "lon": h.lon,
                    "distance_from_path_km": h.distance_from_path_km,
                    "detail": h.detail,
                }
                for h in t.nearby_hazards
            ],
        }
        for t in rows
    ]