//! Minimal flag parser shared by `bunos env` and `bunos cookie`.

pub(crate) struct Spec {
    pub(crate) long: &'static str,
    pub(crate) short: Option<char>,
    pub(crate) takes_value: bool,
}

pub(crate) const fn flag(long: &'static str) -> Spec {
    Spec {
        long,
        short: None,
        takes_value: false,
    }
}

pub(crate) const fn option(long: &'static str) -> Spec {
    Spec {
        long,
        short: None,
        takes_value: true,
    }
}

pub(crate) const fn short_flag(long: &'static str, short: char) -> Spec {
    Spec {
        long,
        short: Some(short),
        takes_value: false,
    }
}

pub(crate) const fn short_option(long: &'static str, short: char) -> Spec {
    Spec {
        long,
        short: Some(short),
        takes_value: true,
    }
}

#[derive(Default)]
pub(crate) struct Args {
    pub(crate) positional: Vec<String>,
    opts: Vec<(&'static str, Option<String>)>,
}

impl Args {
    pub(crate) fn parse(args: &[String], specs: &[Spec]) -> Result<Args, String> {
        let mut parsed = Args::default();
        let mut i = 0;
        while i < args.len() {
            let arg = &args[i];
            i += 1;
            if arg == "--" {
                parsed.positional.extend(args[i..].iter().cloned());
                break;
            }
            if arg == "-" || !arg.starts_with('-') {
                parsed.positional.push(arg.clone());
                continue;
            }
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) if name.starts_with("--") => (name, Some(value.to_string())),
                _ => (arg.as_str(), None),
            };
            let spec = if let Some(long) = name.strip_prefix("--") {
                specs.iter().find(|s| s.long == long)
            } else {
                let mut chars = name[1..].chars();
                match (chars.next(), chars.next()) {
                    (Some(c), None) => specs.iter().find(|s| s.short == Some(c)),
                    _ => None,
                }
            };
            let Some(spec) = spec else {
                return Err(format!("unknown option {name:?}"));
            };
            if spec.takes_value {
                let value = match inline {
                    Some(value) => value,
                    None => {
                        let Some(value) = args.get(i) else {
                            return Err(format!("--{} needs a value", spec.long));
                        };
                        i += 1;
                        value.clone()
                    }
                };
                parsed.opts.push((spec.long, Some(value)));
            } else {
                if inline.is_some() {
                    return Err(format!("--{} does not take a value", spec.long));
                }
                parsed.opts.push((spec.long, None));
            }
        }
        Ok(parsed)
    }

    pub(crate) fn has(&self, long: &str) -> bool {
        self.opts.iter().any(|(name, _)| *name == long)
    }

    pub(crate) fn value(&self, long: &str) -> Option<&str> {
        self.opts
            .iter()
            .rev()
            .find(|(name, _)| *name == long)
            .and_then(|(_, value)| value.as_deref())
    }

    pub(crate) fn values(&self, long: &str) -> Vec<&str> {
        self.opts
            .iter()
            .filter(|(name, _)| *name == long)
            .filter_map(|(_, value)| value.as_deref())
            .collect()
    }
}
