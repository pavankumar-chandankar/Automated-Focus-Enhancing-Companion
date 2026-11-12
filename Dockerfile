FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 FOCUSBUDDY_DB_PATH=/app/var/focusbuddy.sqlite3
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN pip install --no-cache-dir . && mkdir -p /app/var && useradd --create-home --uid 10001 focusbuddy && chown -R focusbuddy:focusbuddy /app/var
USER focusbuddy
EXPOSE 8000
CMD ["uvicorn", "focusbuddy.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
