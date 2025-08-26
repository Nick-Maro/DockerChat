FROM python:3.11-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 80
CMD ["python", "app.py"]