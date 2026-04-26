import asyncio
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_analyze():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/analyze/",
            json={
                "code": "def hello():\n    print('world')",
                "language": "python"
            }
        )
        print(response.status_code)
        print(response.json())

if __name__ == "__main__":
    test_analyze()
