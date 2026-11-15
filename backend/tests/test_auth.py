from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import Hazard, Mission, RouteAnalysis, TelemetrySample  # noqa: F401
from app.models.user import User, UserSession, UserTraverseHistory, TraversePathHazard  # noqa: F401

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.create_all(bind=engine)


def override_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_db
client = TestClient(app)


def test_auth_and_user_traverse_history():
    # 1. Register User
    reg_res = client.post("/api/auth/register", json={
        "username": "ares_astronaut",
        "email": "astronaut@ares.nasa.gov",
        "password": "supersecretpassword123",
        "callsign": "ARES-ALPHA-1"
    })
    assert reg_res.status_code == 201, reg_res.text
    reg_data = reg_res.json()
    token = reg_data["access_token"]
    assert token
    assert reg_data["user"]["username"] == "ares_astronaut"

    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get Current User Profile
    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "astronaut@ares.nasa.gov"

    # 3. Save User Traverse with Path Hazards
    traverse_payload = {
        "mission_id": "jezero",
        "route_name": "Jezero Delta Front Traverse",
        "route_mode": "safe",
        "decision": "GO",
        "start_lat": 18.432,
        "start_lon": 77.221,
        "end_lat": 18.482,
        "end_lon": 77.301,
        "distance_km": 3.42,
        "estimated_time_min": 78,
        "max_slope_deg": 11.4,
        "safety_score": 92.5,
        "o2_used_liters": 14.2,
        "waypoints": [
            {"lat": 18.432, "lon": 77.221, "elevation": -2500},
            {"lat": 18.482, "lon": 77.301, "elevation": -2450}
        ],
        "nearby_hazards": [
            {
                "hazard_name": "Boulder field hazard",
                "category": "boulders",
                "severity": 4,
                "lat": 18.455,
                "lon": 77.260,
                "distance_from_path_km": 0.045,
                "detail": "Large basalt boulders exceeding 1.2m"
            }
        ]
    }

    save_res = client.post("/api/auth/traverses", json=traverse_payload, headers=headers)
    assert save_res.status_code == 201, save_res.text
    save_data = save_res.json()
    assert save_data["status"] == "recorded"
    assert save_data["hazards_indexed"] == 1

    # 4. Fetch User Traverses & Path Hazards History
    list_res = client.get("/api/auth/traverses", headers=headers)
    assert list_res.status_code == 200
    history = list_res.json()
    assert len(history) == 1
    assert history[0]["route_name"] == "Jezero Delta Front Traverse"
    assert len(history[0]["nearby_hazards"]) == 1
    assert history[0]["nearby_hazards"][0]["hazard_name"] == "Boulder field hazard"
    assert history[0]["nearby_hazards"][0]["distance_from_path_km"] == 0.045

    # 5. User Logout
    logout_res = client.post("/api/auth/logout", headers=headers)
    assert logout_res.status_code == 200
    assert logout_res.json()["status"] == "logged_out"
