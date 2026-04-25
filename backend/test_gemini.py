import os
import google.generativeai as genai

genai.configure(api_key=os.environ.get("GOOGLE_API_KEY", "AIzaSyDAPQ7NLHaOvAUwiN5d0xwlPIjmH-oqS7c"))

for m in genai.list_models():
    if 'generateContent' in m.supported_generation_methods:
        print(m.name)
