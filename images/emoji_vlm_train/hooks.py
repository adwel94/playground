"""HuggingFace TrainerCallback 훅."""

import time

from transformers import TrainerCallback

from utils.discord import send_progress_notification


class DiscordHook(TrainerCallback):
    def __init__(self, run_name: str, hook_steps: int = 10):
        self.run_name = run_name
        self.hook_steps = hook_steps
        self.training_start_time = None

    def on_train_begin(self, args, state, control, **kwargs):
        self.training_start_time = time.time()

    def on_step_end(self, args, state, control, **kwargs):
        if state.global_step % self.hook_steps == 0 and state.global_step != 0:
            send_progress_notification(
                title=f"{self.run_name} Training",
                current_step=state.global_step,
                total_steps=state.max_steps,
                start_time=self.training_start_time,
            )
