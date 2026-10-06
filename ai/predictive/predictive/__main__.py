"""python -m predictive <command>. See ai/README.md."""

import argparse

from . import simulate, training


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m predictive", description="The predictive service of the Command Post.")
    commands = parser.add_subparsers(dest="command", required=True)
    sim = commands.add_parser(
        "simulate", help="train on synthetic nominal, replay a slow drift, print the lead over the firmware's thresholds"
    )
    sim.add_argument("--train-seed", type=int, default=0, help="seed of the 2 h of nominal it trains on")
    sim.add_argument("--seed", type=int, default=1, help="seed of the drift scenario it replays")
    training.add_parser(commands)
    args = parser.parse_args(argv)
    if args.command == "simulate":
        print(simulate.report(simulate.run(train_seed=args.train_seed, seed=args.seed)))
    elif args.command == "train":
        training.command(args)


if __name__ == "__main__":
    main()
