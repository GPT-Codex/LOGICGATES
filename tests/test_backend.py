import os
import json
import pytest
from app import app, DATA_DIR, PROJECTS_DIR, MODULES_DIR, LIBRARIES_DIR

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_static_routes(client):
    # Root should try to serve frontend/index.html (might not exist yet, so expect 404 or success if exists)
    response = client.get("/")
    assert response.status_code in [200, 404]

def test_projects_api(client):
    # Test listing projects
    res = client.get("/api/projects")
    assert res.status_code == 200
    assert "projects" in res.json

    # Test saving project
    payload = {"components": [], "wires": []}
    res = client.post("/api/projects/test_proj", json=payload)
    assert res.status_code == 200
    assert res.json["status"] == "success"

    # Test loading project
    res = client.get("/api/projects/test_proj")
    assert res.status_code == 200
    assert res.json == payload

    # Test loading non-existent project
    res = client.get("/api/projects/non_existent")
    assert res.status_code == 404

def test_modules_api(client):
    # Test listing custom modules
    res = client.get("/api/modules")
    assert res.status_code == 200
    assert "modules" in res.json

    # Test saving a custom module
    payload = {
        "id": "my_custom_module",
        "name": "My Custom Module",
        "description": "A simple custom module",
        "category": "Custom",
        "inputs": ["A", "B"],
        "outputs": ["Q"],
        "components": [],
        "wires": []
    }
    res = client.post("/api/modules", json=payload)
    assert res.status_code == 200
    assert res.json["status"] == "success"

    # Test listing contains our custom module
    res = client.get("/api/modules")
    assert res.status_code == 200
    modules = res.json["modules"]
    assert any(m["id"] == "my_custom_module" for m in modules)

    # Test deleting custom module
    res = client.delete("/api/modules/my_custom_module")
    assert res.status_code == 200
    assert res.json["status"] == "success"

    # Check deleted
    res = client.get("/api/modules")
    modules = res.json["modules"]
    assert not any(m["id"] == "my_custom_module" for m in modules)

def test_libraries_api(client):
    # Test listing libraries
    res = client.get("/api/libraries")
    assert res.status_code == 200
    assert "libraries" in res.json

    # Test saving library
    payload = {
        "name": "MyLibrary",
        "modules": []
    }
    res = client.post("/api/libraries", json=payload)
    assert res.status_code == 200
    assert res.json["status"] == "success"
