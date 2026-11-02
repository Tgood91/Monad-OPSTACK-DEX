"""CLI for skills-ref library — DEX Engineering Skill Registry."""

import json
import sys
from pathlib import Path

import click

from .errors import SkillError
from .parser import read_properties
from .prompt import to_prompt
from .validator import validate


def _resolve_skill_path(path: Path) -> Path:
    """Resolve SKILL.md file path to its parent directory."""
    if path.is_file() and path.name.lower() == "skill.md":
        return path.parent
    return path


def _collect_skill_dirs(root: Path) -> list[Path]:
    """Recursively find all skill directories under root."""
    return sorted(
        p.parent for p in root.rglob("[Ss][Kk][Ii][Ll][Ll].[Mm][Dd]")
    )


@click.group()
@click.version_option()
def main():
    """DEX Engineering Skill Registry.

    Manage, validate, and export Agent Skills for DEX development
    on Monad and OP Stack chains. Skills are compatible with Claude
    Code, VS Code agents, and OpenAI Codex.
    """
    pass


@main.command("validate")
@click.argument("skill_path", type=click.Path(exists=True, path_type=Path))
@click.option("--strict", is_flag=True, help="Treat warnings as errors.")
def validate_cmd(skill_path: Path, strict: bool):
    """Validate a skill directory or SKILL.md file.

    Checks for valid frontmatter, required fields, and naming conventions.

    Exit codes:
        0: Valid
        1: Errors found
    """
    skill_path = _resolve_skill_path(skill_path)

    errors = validate(skill_path)

    if errors:
        click.echo(f"Validation failed: {skill_path}", err=True)
        for error in errors:
            click.echo(f"  ✗ {error}", err=True)
        sys.exit(1)

    click.echo(f"  ✓ Valid: {skill_path}")


@main.command("read-properties")
@click.argument("skill_path", type=click.Path(exists=True, path_type=Path))
@click.option("--key", default=None, help="Output a single property value.")
def read_properties_cmd(skill_path: Path, key: str | None):
    """Read and print skill properties as JSON.

    Parses YAML frontmatter from SKILL.md and outputs as JSON.
    Use --key to extract a single property value.

    Exit codes:
        0: Success
        1: Parse error
    """
    try:
        skill_path = _resolve_skill_path(skill_path)
        props = read_properties(skill_path)
        data = props.to_dict()

        if key:
            if key not in data:
                click.echo(f"Error: property '{key}' not found.", err=True)
                sys.exit(1)
            click.echo(data[key])
        else:
            click.echo(json.dumps(data, indent=2))

    except SkillError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@main.command("to-prompt")
@click.argument(
    "skill_paths",
    type=click.Path(exists=True, path_type=Path),
    nargs=-1,
    required=True,
)
def to_prompt_cmd(skill_paths: tuple[Path, ...]):
    """Generate <available_skills> XML for agent system prompts.

    Accepts one or more skill directories or SKILL.md files.
    Output can be injected directly into an agent prompt.

    Exit codes:
        0: Success
        1: Error
    """
    try:
        resolved = [_resolve_skill_path(p) for p in skill_paths]
        click.echo(to_prompt(resolved))
    except SkillError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@main.command("list")
@click.argument(
    "registry_path",
    type=click.Path(exists=True, path_type=Path),
    default=".",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON array.")
def list_cmd(registry_path: Path, as_json: bool):
    """List all skills found under a registry directory.

    Walks the directory tree and prints every skill found.

    Exit codes:
        0: Success
        1: Error
    """
    try:
        skills = _collect_skill_dirs(registry_path)

        if not skills:
            click.echo("No skills found.", err=True)
            sys.exit(1)

        if as_json:
            entries = []
            for skill_dir in skills:
                try:
                    props = read_properties(skill_dir)
                    entries.append({
                        "path": str(skill_dir),
                        **props.to_dict(),
                    })
                except SkillError:
                    entries.append({"path": str(skill_dir), "error": "parse failed"})
            click.echo(json.dumps(entries, indent=2))
        else:
            for skill_dir in skills:
                try:
                    props = read_properties(skill_dir)
                    data = props.to_dict()
                    name = data.get("name", skill_dir.name)
                    desc = data.get("description", "")
                    click.echo(f"  {name:<30} {skill_dir}")
                    if desc:
                        click.echo(f"  {'':30} {desc[:72]}")
                except SkillError:
                    click.echo(f"  {'(parse error)':<30} {skill_dir}", err=True)

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
