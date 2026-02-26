.PHONY: safari-vlm-train emoji-vlm-train

TAG ?= 0.0.1

safari-vlm-train:
	docker build -f images/safari_vlm_train/Dockerfile -t adwel94/safari-vlm-train:$(TAG) .
	docker build -f images/safari_vlm_train/Dockerfile -t adwel94/safari-vlm-train:latest .
	docker push adwel94/safari-vlm-train:$(TAG)
	docker push adwel94/safari-vlm-train:latest

emoji-vlm-train:
	docker build -f images/emoji_vlm_train/Dockerfile -t adwel94/emoji-vlm-train:$(TAG) .
	docker build -f images/emoji_vlm_train/Dockerfile -t adwel94/emoji-vlm-train:latest .
	docker push adwel94/emoji-vlm-train:$(TAG)
	docker push adwel94/emoji-vlm-train:latest
