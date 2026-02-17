"""
This script checks for active RunPod pods and sends a Slack notification
if any are found. It's designed to be run from a GitHub Action.
"""
import os
import sys
from datetime import datetime, timezone

# Add the project root to the Python path to allow for absolute imports
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from utils.runpod_client import pods
from utils.discord import send_discord, DiscordChannel

def _format_uptime(start_time_str: str) -> str:
    """ISO8601 형식의 시작 시간을 가동 시간 문자열로 변환."""
    if not start_time_str:
        return "N/A"
    try:
        # '2025-02-17T06:48:42.000Z' 등 다양한 형식 처리 시도
        start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        duration = now - start_time
        
        hours, remainder = divmod(int(duration.total_seconds()), 3600)
        minutes, _ = divmod(remainder, 60)
        
        if hours > 0:
            return f"{hours}시간 {minutes}분"
        return f"{minutes}분"
    except Exception:
        return "N/A"

def check_and_notify():
    """
    Checks for active pods and sends a Discord notification if any exist.
    """
    print("Checking for active RunPod pods...")
    try:
        active_pods = pods()
        pod_count = len(active_pods)

        if pod_count > 0:
            print(f"Found {pod_count} active pod(s). Sending notification.")
            
            pod_details = []
            for pod in active_pods:
                pod_id = pod.get('id')
                pod_name = pod.get('name', 'N/A')
                gpu_name = pod.get('machine', {}).get('gpuDisplayName', 'N/A')
                status = pod.get('desiredStatus', 'N/A')
                
                # uptimeSeconds 또는 startedAt/createdAt 필드 시도
                uptime_val = pod.get('uptimeSeconds')
                if uptime_val:
                    hours, remainder = divmod(int(uptime_val), 3600)
                    minutes, _ = divmod(remainder, 60)
                    uptime_str = f"{hours}시간 {minutes}분" if hours > 0 else f"{minutes}분"
                else:
                    uptime_str = _format_uptime(pod.get('startedAt') or pod.get('createdAt'))
                
                pod_details.append(f"- `{pod_id}` ({pod_name}) | {gpu_name} | {status} | ⏱️ {uptime_str}")
            
            details_str = "\n".join(pod_details)
            console_url = "https://www.runpod.io/console/pods"
            message = f"⚠️ **RunPod Active Alert**\n현재 {pod_count}개의 파드가 실행 중입니다. 과금을 방지하려면 확인 후 종료하세요!\n\n{details_str}"
            
            # 링크 버튼 추가 (Webhook 지원 형식)
            components = [{
                "type": 1,
                "components": [{
                    "type": 2,
                    "style": 5, # Link
                    "label": "🚀 RunPod 콘솔 바로가기",
                    "url": console_url
                }]
            }]
            
            send_discord(message, channel=DiscordChannel.RUNPOD, components=components)
        else:
            print("No active pods found. All clear.")

    except Exception as e:
        error_message = f"🚨 Failed to check RunPod status: {e}"
        print(error_message)
        send_discord(error_message, channel=DiscordChannel.RUNPOD)


if __name__ == "__main__":

    check_and_notify()
