"""WandB 로그인 유틸."""

import os


def login_wandb(project_name: str, run_name: str = None):
    """WandB 로그인 및 init. WANDB_API_KEY 미설정 시 무시."""
    if not os.getenv("WANDB_API_KEY"):
        return False
    import wandb
    wandb.login()
    os.environ["WANDB_PROJECT"] = project_name
    wandb.init(
        name=run_name,
        project=project_name,
        entity=os.getenv("WANDB_ENTITY"),
        reinit="return_previous",
    )
    return True
