FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 YOLO_CONFIG_DIR=/tmp/ultralytics
RUN pip install --no-cache-dir torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir ultralytics==8.4.115 boto3==1.42.63 pillow==11.3.0 opencv-python-headless==4.12.0.88 \
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==4.12.0.88
WORKDIR /app
COPY inference_core.py website_adapter.py worker.py ./
USER 10001
CMD ["python", "worker.py"]
