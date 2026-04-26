import asyncio
from fastapi.testclient import TestClient
from app.main import app

def test_ask_ai():
    with TestClient(app) as client:
        # First scan
        scan_resp = client.post(
            "/api/v1/ask/scan",
            json={"session_id": "test_session", "code": "def hello_world():\n    print('hello')", "language": "python"}
        )
        print("Scan:", scan_resp.status_code)

        # Then ask a semantic question
        ask_resp = client.post(
            "/api/v1/ask/",
            json={"session_id": "test_session", "question": "What does hello_world do?", "code": "def hello_world():\n    print('hello')", "language": "python"}
        )
        print("Ask:", ask_resp.status_code)
        if ask_resp.status_code != 200:
            print(ask_resp.text)
        else:
            print("OK")

if __name__ == "__main__":
    test_ask_ai()
