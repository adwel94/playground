.PHONY: safari-vlm-train emoji-vlm-train

SAFARI_TAG ?= 0.1.0

safari-vlm-train:
	docker build -f images/safari_vlm_train/Dockerfile -t adwel94/safari-vlm-train:$(SAFARI_TAG) .
	docker build -f images/safari_vlm_train/Dockerfile -t adwel94/safari-vlm-train:latest .
	docker push adwel94/safari-vlm-train:$(SAFARI_TAG)
	docker push adwel94/safari-vlm-train:latest

EMOJI_TAG ?= 0.0.2

emoji-vlm-train:
	docker build -f images/emoji_vlm_train/Dockerfile -t adwel94/emoji-vlm-train:$(EMOJI_TAG) .
	docker build -f images/emoji_vlm_train/Dockerfile -t adwel94/emoji-vlm-train:latest .
	docker push adwel94/emoji-vlm-train:$(EMOJI_TAG)
	docker push adwel94/emoji-vlm-train:latest
