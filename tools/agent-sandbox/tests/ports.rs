//! Naming loopback ports: --agent-ports values and what a sandbox's loopback access adds up to.

use agent_sandbox::cli::{Cli, Cmd};
use agent_sandbox::ports::{merged, Loopback, PortRange, IANA_DYNAMIC_PORTS, MAX_AGENT_PORTS};

use clap::Parser;

fn range(first: u16, last: u16) -> PortRange {
    PortRange { first, last }
}

#[test]
fn a_port_or_a_range_is_parsed() {
    assert_eq!("8787".parse::<PortRange>().unwrap(), range(8787, 8787));
    assert_eq!(
        "18787-18790".parse::<PortRange>().unwrap(),
        range(18787, 18790)
    );
    assert_eq!("65535".parse::<PortRange>().unwrap().count(), 1);
    assert_eq!(range(18787, 18790).count(), 4);
    assert!(range(18787, 18790).contains(18790));
    assert!(!range(18787, 18790).contains(18791));
}

#[test]
fn what_is_not_a_port_is_refused_with_a_reason() {
    for (bad, why) in [
        ("0", "any free port"),
        ("0-10", "any free port"),
        ("9000-8000", "ends before it starts"),
        ("65536", "not a port"),
        ("http", "not a port"),
        ("", "not a port"),
        ("80-", "not a port"),
        ("-80", "not a port"),
        ("1-2-3", "not a port"),
        ("*", "not a port"),
    ] {
        let err = bad.parse::<PortRange>().unwrap_err();
        assert!(format!("{err:#}").contains(why), "{bad:?}: {err:#}");
    }
}

#[test]
fn ranges_that_overlap_or_touch_become_one() {
    assert_eq!(
        merged(&[
            range(30, 40),
            range(10, 12),
            range(13, 20),
            range(35, 50),
            range(60, 60)
        ]),
        [range(10, 20), range(30, 50), range(60, 60)]
    );
    assert_eq!(
        merged(&[range(65535, 65535), range(65000, 65534)]),
        [range(65000, 65535)]
    );
    assert!(merged(&[]).is_empty());
}

#[test]
fn nothing_named_is_no_loopback_at_all() {
    let net = Loopback::new(&[], &[], None).unwrap();
    assert_eq!(net, Loopback::default());
    assert!(net.reach.is_empty() && net.own.is_empty() && net.ephemeral.is_none());
}

#[test]
fn host_ports_are_connect_only_and_agent_ports_are_the_commands_own() {
    let net = Loopback::new(
        &[18010, 18011, 40001],
        &[range(8787, 8787), range(8788, 8790)],
        Some(IANA_DYNAMIC_PORTS),
    )
    .unwrap();
    assert_eq!(net.reach, [range(18010, 18011), range(40001, 40001)]);
    assert_eq!(net.own, [range(8787, 8790)]);
    assert_eq!(net.ephemeral, Some(range(49152, 65535)));
}

#[test]
fn port_zero_and_too_many_agent_ports_are_refused() {
    let err = Loopback::new(&[0], &[], None).unwrap_err();
    assert!(format!("{err:#}").contains("--host-port 0"));
    let limit = u16::try_from(MAX_AGENT_PORTS).unwrap();
    assert!(Loopback::new(&[], &[range(20000, 20000 + limit - 1)], None).is_ok());
    let err = Loopback::new(&[], &[range(20000, 20000 + limit)], None).unwrap_err();
    assert!(format!("{err:#}").contains("--agent-ports"), "{err:#}");
    // The same ports named twice count once.
    assert!(Loopback::new(
        &[],
        &[
            range(20000, 20000 + limit - 1),
            range(20000, 20000 + limit - 1)
        ],
        None
    )
    .is_ok());
}

fn run_args(extra: &[&str]) -> Result<agent_sandbox::cli::SandboxArgs, clap::Error> {
    let argv = ["agent-sandbox", "run", "--own-dir", "/run"]
        .iter()
        .chain(extra)
        .chain(&["--", "true"]);
    match Cli::try_parse_from(argv)?.cmd {
        Cmd::Run(args) => Ok(args),
        other => panic!("not a run: {other:?}"),
    }
}

#[test]
fn the_command_line_names_ports_and_ranges_and_defaults_to_none() {
    let none = run_args(&[]).unwrap();
    assert!(none.agent_ports.is_empty() && none.host_port.is_empty() && !none.ephemeral_ports);
    let args = run_args(&[
        "--host-port",
        "18010",
        "--agent-ports",
        "8787",
        "--agent-ports",
        "9229-9231",
        "--ephemeral-ports",
    ])
    .unwrap();
    assert_eq!(args.host_port, [18010]);
    assert_eq!(args.agent_ports, [range(8787, 8787), range(9229, 9231)]);
    assert!(args.ephemeral_ports);
    for bad in ["0", "9000-8000", "all"] {
        assert!(run_args(&["--agent-ports", bad]).is_err(), "{bad}");
    }
}
