"""RunPod API 래퍼 유틸리티 모듈.

RunPod SDK를 래핑하여 GPU 조회, Pod 생성/관리, VLM 서빙 등의 기능을 제공한다.
"""

import runpod


def init(api_key: str) -> None:
    """RunPod API 키를 설정한다."""
    runpod.api_key = api_key


def get_gpu_list() -> list[dict]:
    """전체 GPU 목록을 VRAM순으로 정렬하여 반환한다."""
    gpus = runpod.get_gpus()
    gpus.sort(key=lambda g: g.get("memoryInGb", 0))

    print(f"{'GPU ID':<30} {'VRAM(GB)':>8} {'Secure':>8} {'Community':>10}")
    print("-" * 60)
    for gpu in gpus:
        gpu_id = gpu.get("id", "N/A")
        vram = gpu.get("memoryInGb", "N/A")
        secure_price = gpu.get("securePrice", "N/A")
        community_price = gpu.get("communityPrice", "N/A")
        print(f"{gpu_id:<30} {vram:>8} ${secure_price:>7} ${community_price:>9}")

    return gpus


def get_gpu_detail(gpu_id: str) -> dict:
    """특정 GPU의 상세 정보(가격, 재고 등)를 반환한다."""
    gpu = runpod.get_gpu(gpu_id)
    return gpu


def create_pod(
    name: str,
    image_name: str,
    gpu_type_id: str,
    gpu_count: int = 1,
    volume_in_gb: int = 50,
    container_disk_in_gb: int = 20,
    ports: str | None = "8888/http,22/tcp",
    env: dict | None = None,
    **kwargs,
) -> dict:
    """Pod을 생성한다.

    Args:
        name: Pod 이름
        image_name: Docker 이미지 이름
        gpu_type_id: GPU 타입 ID (예: "NVIDIA GeForce RTX 4090")
        gpu_count: GPU 수
        volume_in_gb: 영구 볼륨 크기(GB)
        container_disk_in_gb: 컨테이너 디스크 크기(GB)
        ports: 포트 매핑 문자열
        env: 환경변수 딕셔너리
        **kwargs: runpod.create_pod에 전달할 추가 파라미터
    """
    pod = runpod.create_pod(
        name=name,
        image_name=image_name,
        gpu_type_id=gpu_type_id,
        gpu_count=gpu_count,
        volume_in_gb=volume_in_gb,
        container_disk_in_gb=container_disk_in_gb,
        ports=ports,
        env=env or {},
        **kwargs,
    )
    print(f"Pod 생성됨: {pod.get('id', 'N/A')} ({name})")
    return pod


def get_pods() -> list[dict]:
    """전체 Pod 목록을 반환한다."""
    pods = runpod.get_pods()

    print(f"{'Pod ID':<28} {'Name':<25} {'Status':<12} {'GPU':<25}")
    print("-" * 90)
    for pod in pods:
        pod_id = pod.get("id", "N/A")
        name = pod.get("name", "N/A")
        status = pod.get("desiredStatus", "N/A")
        gpu = pod.get("machine", {}).get("gpuDisplayName", "N/A") if pod.get("machine") else "N/A"
        print(f"{pod_id:<28} {name:<25} {status:<12} {gpu:<25}")

    return pods


def get_pod(pod_id: str) -> dict:
    """특정 Pod의 상세 정보를 반환한다."""
    pod = runpod.get_pod(pod_id)
    return pod


def stop_pod(pod_id: str) -> None:
    """Pod을 정지한다 (과금 중지, 볼륨 유지)."""
    runpod.stop_pod(pod_id)
    print(f"Pod 정지됨: {pod_id}")


def resume_pod(pod_id: str, gpu_count: int = 1) -> None:
    """정지된 Pod을 재개한다."""
    runpod.resume_pod(pod_id, gpu_count=gpu_count)
    print(f"Pod 재개됨: {pod_id}")


def terminate_pod(pod_id: str) -> None:
    """Pod을 완전히 삭제한다 (볼륨 포함)."""
    runpod.terminate_pod(pod_id)
    print(f"Pod 삭제됨: {pod_id}")


def create_vlm_pod(
    name: str,
    model_name: str,
    gpu_type_id: str = "NVIDIA GeForce RTX 4090",
    gpu_count: int = 1,
    volume_in_gb: int = 100,
    container_disk_in_gb: int = 20,
    max_model_len: int = 4096,
    gpu_memory_utilization: float = 0.9,
    dtype: str = "half",
    **kwargs,
) -> dict:
    """VLM 서빙용 Pod을 vLLM Worker 이미지와 프리셋 환경변수로 생성한다.

    Args:
        name: Pod 이름
        model_name: HuggingFace 모델 이름 (예: "Qwen/Qwen3-VL-2B")
        gpu_type_id: GPU 타입 ID
        gpu_count: GPU 수
        volume_in_gb: 영구 볼륨 크기(GB)
        container_disk_in_gb: 컨테이너 디스크 크기(GB)
        max_model_len: 최대 시퀀스 길이
        gpu_memory_utilization: GPU 메모리 사용률 (0.0~1.0)
        dtype: 데이터 타입 (half, float16, bfloat16 등)
        **kwargs: create_pod에 전달할 추가 파라미터
    """
    env = {
        "MODEL_NAME": model_name,
        "DTYPE": dtype,
        "GPU_MEMORY_UTILIZATION": str(gpu_memory_utilization),
        "MAX_MODEL_LEN": str(max_model_len),
    }

    return create_pod(
        name=name,
        image_name="runpod/worker-v1-vllm:v2.7.0stable-cuda12.1.0",
        gpu_type_id=gpu_type_id,
        gpu_count=gpu_count,
        volume_in_gb=volume_in_gb,
        container_disk_in_gb=container_disk_in_gb,
        ports="8000/http,22/tcp",
        env=env,
        **kwargs,
    )
