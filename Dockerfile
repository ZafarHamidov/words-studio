# Serve the Flask edition as a non-root process. Edit for runtime packages or startup.
FROM python:3.14-slim-trixie
WORKDIR /app
COPY requirements.txt requirements-hosted.txt ./
RUN pip install --no-cache-dir -r requirements-hosted.txt \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown app:app /data
COPY app.py server_storage.py wsgi.py ./
COPY templates ./templates
COPY static ./static
COPY data/academic_words.json data/cefr.json data/freq_words.json data/sat_words.json ./data/
USER app
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "120", "--worker-tmp-dir", "/tmp", "--access-logfile", "-", "--error-logfile", "-", "wsgi:application"]
