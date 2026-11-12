"""Local command-line tools."""
import argparse
import json
from pathlib import Path

from focusbuddy.config import Settings
from focusbuddy.llm.evaluation import evaluate_cases
from focusbuddy.storage.repository import Repository


def main(argv=None):
    parser = argparse.ArgumentParser(description="Focus Buddy local tools")
    commands = parser.add_subparsers(dest="command", required=True)
    eval_cmd = commands.add_parser("evaluate-prompts", help="Validate offline prompt-response fixtures")
    eval_cmd.add_argument("--fixtures", type=Path, default=Path("evaluations/prompt_contract_cases.jsonl"))
    eval_cmd.add_argument("--output", type=Path)
    commands.add_parser("purge-expired", help="Delete expired local sessions")
    args = parser.parse_args(argv)
    if args.command == "evaluate-prompts":
        result = evaluate_cases(args.fixtures)
    else:
        result = {"expired_sessions_removed": Repository(Settings.from_env().db_path).purge_expired()}
    rendered = json.dumps(result, indent=2, allow_nan=False)
    if getattr(args, "output", None):
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)


if __name__ == "__main__":
    main()
