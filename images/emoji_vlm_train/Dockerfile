FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
WORKDIR /app
COPY images/emoji_vlm_train/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY images/emoji_vlm_train/options.py images/emoji_vlm_train/train.py \
     images/emoji_vlm_train/monitoring.py images/emoji_vlm_train/hooks.py ./
COPY utils/ ./utils/
CMD ["python", "-u", "train.py"]
