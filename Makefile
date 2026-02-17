.PHONY: safari-vlm-train

safari-vlm-train:
	docker build -f images/safari_vlm_train/Dockerfile -t lohasmeal/safari-vlm-train:latest .
