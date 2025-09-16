FROM python:3.11-alpine

WORKDIR /app

RUN apk add --no-cache curl && \
    mkdir -p /var/log/shared/firewall && \
    mkdir -p /data && \
    chmod -R 777 /var/log/shared && \
    chmod 777 /data

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 80
CMD ["python", "app.py"]