//! The named host sets in presets.toml.

use agent_sandbox::presets;
use agent_sandbox::proxy::{AllowList, HTTPS_PORT};

#[test]
fn the_npm_preset_is_the_registry_and_nothing_else() {
    assert_eq!(
        presets::hosts("npm").unwrap(),
        vec!["registry.npmjs.org".to_string()]
    );
}

#[test]
fn an_unknown_preset_is_an_error_that_lists_the_known_ones() {
    let err = presets::hosts("everything").unwrap_err().to_string();
    assert!(
        err.contains("npm") && err.contains("claude") && err.contains("playwright"),
        "{err}"
    );
}

#[test]
fn every_preset_says_why_and_holds_only_valid_host_rules() {
    let all = presets::all().unwrap();
    assert!(all.len() >= 3);
    for p in &all {
        assert!(!p.why.trim().is_empty(), "{} has no reason", p.name);
        assert!(!p.hosts.is_empty(), "{} is empty", p.name);
        AllowList::parse(&p.hosts).unwrap_or_else(|e| panic!("{}: {e}", p.name));
    }
}

#[test]
fn no_preset_or_combination_of_presets_reaches_github() {
    let every: Vec<String> = presets::all()
        .unwrap()
        .into_iter()
        .flat_map(|p| p.hosts)
        .collect();
    let allow = AllowList::parse(&every).unwrap();
    for host in [
        "github.com",
        "api.github.com",
        "raw.githubusercontent.com",
        "codeload.github.com",
        "objects.githubusercontent.com",
        "gist.github.com",
    ] {
        assert!(!allow.allows(host, HTTPS_PORT), "{host} must stay blocked");
    }
}
