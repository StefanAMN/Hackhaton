import asyncio
from fastapi.testclient import TestClient
from app.main import app
import io

client = TestClient(app)

def test_analyze_upload():
    with TestClient(app) as client:
        file_content = b"def hello():\n    print('world')\n\ndef world():\n    print('hello')"
        response = client.post(
            "/api/v1/analyze/upload",
            files={"file": ("test.py", io.BytesIO(file_content), "text/plain")},
            data={"language": "python"}
        )
        print(response.status_code)
        if response.status_code != 200:
            print(response.text)
        else:
            print("OK")

if __name__ == "__main__":
    test_analyze_upload()
