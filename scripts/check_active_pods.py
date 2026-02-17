"""
This script checks for active RunPod pods and sends a Slack notification
if any are found. It's designed to be run from a GitHub Action.
"""
import os
import sys

# Add the project root to the Python path to allow for absolute imports
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from utils.runpod_client import pods
from utils.discord import send_discord, DiscordChannel


def check_and_notify():
    """
    Checks for active pods and sends a Slack notification if any exist.
    """
    print("Checking for active RunPod pods...")
    try:
        active_pods = pods()
        pod_count = len(active_pods)

        if pod_count > 0:
            print(f"Found {pod_count} active pod(s). Sending notification.")
            message = f"🔔 RunPod Alert: {pod_count} pod(s) are currently active."
            send_discord(message, channel=DiscordChannel.RUNPOD)
        else:
            print("No active pods found. All clear.")

    except Exception as e:
        error_message = f"🚨 Failed to check RunPod status: {e}"
        print(error_message)
        send_discord(error_message, channel=DiscordChannel.RUNPOD)


if __name__ == "__main__":

    check_and_notify()
