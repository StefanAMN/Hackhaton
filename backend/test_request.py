import asyncio
import httpx
import json

async def main():
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "http://localhost:8000/api/v1/analyze/",
                json={"code": "def hello():\n    return 'world'", "language": "python"}
            )
            print(resp.status_code)
            print(resp.text)
        except Exception as e:
            print("Error connecting:", e)

asyncio.run(main())
