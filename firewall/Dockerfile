FROM python:3.10-slim

WORKDIR /app

COPY . .

RUN pip install --no-cache-dir -r requirements.txt python-dotenv || true


CMD ["python", "firewall.py"]
