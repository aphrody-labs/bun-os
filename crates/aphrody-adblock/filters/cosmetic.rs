//! Filters that take effect at a page-content level, including CSS selector-based filtering and
//! content script injection.

use memchr::{memchr as find_char, memmem, memrchr as find_char_reverse};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::resources::PermissionMask;
use crate::utils::Hash;

use css_validation::{is_valid_css_style, validate_css_selector};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CosmeticFilterError {
    #[error("punycode error")]
    PunycodeError,
    #[error("invalid action specifier")]
    InvalidActionSpecifier,
    #[error("unsupported syntax")]
    UnsupportedSyntax,
    #[error("missing sharp")]
    MissingSharp,
    #[error("invalid css style")]
    InvalidCssStyle,
    #[error("invalid css selector")]
    InvalidCssSelector,
    #[error("generic unhide")]
    GenericUnhide,
    #[error("generic script inject")]
    GenericScriptInject,
    #[error("procedural and action filters cannot be generic")]
    GenericAction,
    #[error("double negation")]
    DoubleNegation,
    #[error("empty rule")]
    EmptyRule,
    #[error("html filtering is unsupported")]
    HtmlFilteringUnsupported,
    #[error("scriptlet args could not be parsed")]
    InvalidScriptletArgs,
    #[error("location modifiers are unsupported")]
    LocationModifiersUnsupported,
    #[error("procedural filters can only accept a single CSS selector")]
    ProceduralFilterWithMultipleSelectors,
}

/// Refer to <https://github.com/uBlockOrigin/uBlock-issues/wiki/Static-filter-syntax#action-operators>
#[derive(PartialEq, Eq, Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "arg")]
#[serde(rename_all = "kebab-case")]
pub enum CosmeticFilterAction {
    /// Rules with a remove action, e.g. `example.com##.ad:remove()`.
    ///
    /// Matching elements are to be removed from the DOM.
    Remove,
    /// Rules with a custom style for an element, e.g. `example.com##.ad:style(margin: 0)`.
    ///
    /// Argument is one or more CSS property declarations, separated by the standard ;. Some
    /// characters, strings, and values are forbidden.
    ///
    /// The specified CSS styling should be applied to matching elements in the DOM.
    Style(String),
    /// Rules with a remove attribute action, e.g. `example.com##.ad:remove-attr(onclick)`.
    ///
    /// Argument is the name of an HTML attribute.
    ///
    /// The attribute should be removed from matching elements in the DOM.
    RemoveAttr(String),
    /// Rules with a remove class action, e.g. `example.com##.ad:remove-class(advert)`.
    ///
    /// The parameter is the name of a CSS class.
    ///
    /// The class should be removed from matching elements in the DOM.
    RemoveClass(String),
}

impl CosmeticFilterAction {
    fn new_style(style: &str) -> Result<Self, CosmeticFilterError> {
        if !is_valid_css_style(style) {
            return Err(CosmeticFilterError::InvalidCssStyle);
        }
        Ok(Self::Style(style.to_string()))
    }

    fn new_remove_attr(attr: &str) -> Result<Self, CosmeticFilterError> {
        Self::forbid_regex_or_quoted_args(attr)?;
        Ok(CosmeticFilterAction::RemoveAttr(attr.to_string()))
    }

    fn new_remove_class(class: &str) -> Result<Self, CosmeticFilterError> {
        Self::forbid_regex_or_quoted_args(class)?;
        Ok(CosmeticFilterAction::RemoveClass(class.to_string()))
    }

    /// Regex and quoted args aren't supported yet
    fn forbid_regex_or_quoted_args(arg: &str) -> Result<(), CosmeticFilterError> {
        if arg.starts_with('/') || arg.starts_with('\"') || arg.starts_with('\'') {
            return Err(CosmeticFilterError::UnsupportedSyntax);
        }
        Ok(())
    }
}

bitflags::bitflags! {
    /// Boolean flags for cosmetic filter rules.
    #[derive(Serialize, Deserialize, Clone, Debug)]
    #[serde(transparent)]
    pub struct CosmeticFilterMask: u8 {
        const UNHIDE = 1 << 0;
        const SCRIPT_INJECT = 1 << 1;

        // Careful with checking for NONE - will always match
        const NONE = 0;
    }
}

/// Struct representing a parsed cosmetic filter rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CosmeticFilter {
    pub entities: Option<Vec<Hash>>,
    pub hostnames: Option<Vec<Hash>>,
    pub mask: CosmeticFilterMask,
    pub not_entities: Option<Vec<Hash>>,
    pub not_hostnames: Option<Vec<Hash>>,
    pub raw_line: Option<Box<String>>,
    pub selector: Vec<CosmeticFilterOperator>,
    pub action: Option<CosmeticFilterAction>,
    pub permission: PermissionMask,
}

/// Individual parts of a cosmetic filter's selector. Most rules have a CSS selector; some may also
/// have one or more procedural operators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "arg")]
#[serde(rename_all = "kebab-case")]
pub enum CosmeticFilterOperator {
    CssSelector(String),
    HasText(String),
    MatchesAttr(String),
    MatchesCss(String),
    MatchesCssBefore(String),
    MatchesCssAfter(String),
    MatchesPath(String),
    MinTextLength(String),
    Upward(String),
    Xpath(String),
}

pub(crate) enum CosmeticFilterLocationType {
    Entity,
    NotEntity,
    Hostname,
    NotHostname,
    Unsupported,
}

/// Contains hashes of all of the comma separated location items that were populated before the
/// hash separator in a cosmetic filter rule.
#[derive(Default)]
struct CosmeticFilterLocations {
    /// Locations of the form `entity.*`
    entities: Option<Vec<Hash>>,
    /// Locations of the form `~entity.*`
    not_entities: Option<Vec<Hash>>,
    /// Locations of the form `hostname`
    hostnames: Option<Vec<Hash>>,
    /// Locations of the form `~hostname`
    not_hostnames: Option<Vec<Hash>>,
}

impl CosmeticFilter {
    #[inline]
    pub(crate) fn locations_before_sharp(
        line: &str,
        sharp_index: usize,
    ) -> impl Iterator<Item = (CosmeticFilterLocationType, &str)> {
        line[0..sharp_index].split(',').filter_map(|part| {
            if part.is_empty() {
                return None;
            }
            let hostname = part;
            let negation = hostname.starts_with('~');
            let entity = hostname.ends_with(".*");
            let start = if negation { 1 } else { 0 };
            let end = if entity {
                hostname.len() - 2
            } else {
                hostname.len()
            };
            let location = &hostname[start..end];
            // AdGuard regex syntax
            if location.starts_with('/') {
                return Some((CosmeticFilterLocationType::Unsupported, part));
            }
            Some(match (negation, entity) {
                (true, true) => (CosmeticFilterLocationType::NotEntity, location),
                (true, false) => (CosmeticFilterLocationType::NotHostname, location),
                (false, true) => (CosmeticFilterLocationType::Entity, location),
                (false, false) => (CosmeticFilterLocationType::Hostname, location),
            })
        })
    }

    /// Parses the contents of a cosmetic filter rule up to the `##` or `#@#` separator.
    ///
    /// On success, returns hashes of all the comma separated location items that were populated in
    /// the rule.
    ///
    /// This should only be called if `sharp_index` is greater than 0, in which case all four are
    /// guaranteed to be `None`.
    #[inline]
    fn parse_before_sharp(
        line: &str,
        sharp_index: usize,
    ) -> Result<CosmeticFilterLocations, CosmeticFilterError> {
        let mut entities_vec = vec![];
        let mut not_entities_vec = vec![];
        let mut hostnames_vec = vec![];
        let mut not_hostnames_vec = vec![];

        if line.starts_with('[') {
            return Err(CosmeticFilterError::LocationModifiersUnsupported);
        }

        let mut any_unsupported = false;
        for (location_type, location) in Self::locations_before_sharp(line, sharp_index) {
            let hash = if location.is_ascii() {
                crate::utils::fast_hash(location)
            } else {
                match idna::domain_to_ascii(location) {
                    Ok(x) if !x.is_empty() => crate::utils::fast_hash(&x),
                    _ => return Err(CosmeticFilterError::PunycodeError),
                }
            };
            match location_type {
                CosmeticFilterLocationType::NotEntity => not_entities_vec.push(hash),
                CosmeticFilterLocationType::NotHostname => not_hostnames_vec.push(hash),
                CosmeticFilterLocationType::Entity => entities_vec.push(hash),
                CosmeticFilterLocationType::Hostname => hostnames_vec.push(hash),
                CosmeticFilterLocationType::Unsupported => {
                    any_unsupported = true;
                }
            }
        }
        // Discard the rule altogether if there are no supported location types
        if any_unsupported
            && hostnames_vec.is_empty()
            && entities_vec.is_empty()
            && not_hostnames_vec.is_empty()
            && not_entities_vec.is_empty()
        {
            return Err(CosmeticFilterError::UnsupportedSyntax);
        }

        /// Sorts `vec` and wraps it in `Some` if it's not empty, or returns `None` if it is.
        #[inline]
        fn sorted_or_none<T: std::cmp::Ord>(mut vec: Vec<T>) -> Option<Vec<T>> {
            if !vec.is_empty() {
                vec.sort();
                Some(vec)
            } else {
                None
            }
        }

        let entities = sorted_or_none(entities_vec);
        let hostnames = sorted_or_none(hostnames_vec);
        let not_entities = sorted_or_none(not_entities_vec);
        let not_hostnames = sorted_or_none(not_hostnames_vec);

        Ok(CosmeticFilterLocations {
            entities,
            not_entities,
            hostnames,
            not_hostnames,
        })
    }

    /// Turns a string of the format `.selector { background: red }` into
    /// `Some((".selector", "background: red"))`.
    fn split_abp_brace_suffix(s: &str) -> Option<(&str, &str)> {
        if !s.ends_with('}') {
            return None;
        }
        let open = s.rfind('{')?;
        if open == 0 {
            return None;
        }
        let selector = s[..open].trim_end();
        let body = s[open + 1..s.len() - 1].trim();
        if selector.is_empty() {
            return None;
        }
        Some((selector, body))
    }

    /// Returns `Some(true)` for ` remove: true; ` with optional whitespace and semicolon,
    /// `Some(false)` for the corresponding false construction, or `None` otherwise.
    fn parse_abp_remove_body(body: &str) -> Option<bool> {
        let (key, mut val) = body.split_once(":")?;
        if key.trim() != "remove" {
            return None;
        }
        val = val.trim();
        if let Some(stripped_val) = val.strip_suffix(';') {
            val = stripped_val;
        }
        match val {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        }
    }

    /// Parses ABP curly-bracketed style injections and `remove:` directives into corresponding
    /// `CosmeticFilterAction`s.
    fn parse_abp_style_injection(
        after_sharp: &str,
    ) -> Option<Result<(&str, Option<CosmeticFilterAction>), CosmeticFilterError>> {
        let (selector, body) = match Self::split_abp_brace_suffix(after_sharp) {
            Some(parts) => parts,
            None if after_sharp.ends_with('}') => {
                return Some(Err(CosmeticFilterError::InvalidActionSpecifier));
            }
            None => return None,
        };

        Some(match Self::parse_abp_remove_body(body) {
            Some(true) => Ok((selector, Some(CosmeticFilterAction::Remove))),
            Some(false) => Err(CosmeticFilterError::InvalidActionSpecifier),
            None => CosmeticFilterAction::new_style(body).map(|action| (selector, Some(action))),
        })
    }

    /// Parses the contents of a cosmetic filter rule following the `##` or `#@#` separator.
    ///
    /// On success, returns `selector` and `style` according to the rule.
    ///
    /// This should only be called if the rule part after the separator has been confirmed not to
    /// be a script injection rule using `+js()`.
    #[inline]
    fn parse_after_sharp_nonscript(
        after_sharp: &str,
    ) -> Result<(&str, Option<CosmeticFilterAction>), CosmeticFilterError> {
        if after_sharp.starts_with('^') {
            return Err(CosmeticFilterError::HtmlFilteringUnsupported);
        }

        if let Some(result) = Self::parse_abp_style_injection(after_sharp) {
            return result;
        }

        const STYLE_TOKEN: &[u8] = b":style(";
        const REMOVE_ATTR_TOKEN: &[u8] = b":remove-attr(";
        const REMOVE_CLASS_TOKEN: &[u8] = b":remove-class(";

        const REMOVE_TOKEN: &str = ":remove()";

        type PairType = (
            &'static [u8],
            fn(&str) -> Result<CosmeticFilterAction, CosmeticFilterError>,
        );

        const PAIRS: &[PairType] = &[
            (STYLE_TOKEN, CosmeticFilterAction::new_style),
            (REMOVE_ATTR_TOKEN, CosmeticFilterAction::new_remove_attr),
            (REMOVE_CLASS_TOKEN, CosmeticFilterAction::new_remove_class),
        ];

        let action;
        let selector;

        'init: {
            for (token, constructor) in PAIRS {
                if let Some(i) = memmem::find(after_sharp.as_bytes(), token) {
                    if after_sharp.ends_with(')') {
                        // indexing safe because of find and ends_with
                        let arg = &after_sharp[i + token.len()..after_sharp.len() - 1];

                        action = Some(constructor(arg)?);
                        selector = &after_sharp[..i];
                        break 'init;
                    } else {
                        return Err(CosmeticFilterError::InvalidActionSpecifier);
                    }
                }
            }
            if let Some(before_suffix) = after_sharp.strip_suffix(REMOVE_TOKEN) {
                action = Some(CosmeticFilterAction::Remove);
                selector = before_suffix;
                break 'init;
            } else {
                action = None;
                selector = after_sharp;
            }
        }

        Ok((selector, action))
    }

    /// Returns the CSS selector, for rules which only consist of a CSS selector.
    /// If a rule contains procedural operators, this method will return `None`.
    pub fn plain_css_selector(&self) -> Option<&str> {
        assert!(!self.selector.is_empty());
        if self.selector.len() > 1 {
            return None;
        }
        match &self.selector[0] {
            CosmeticFilterOperator::CssSelector(s) => Some(s),
            _ => None,
        }
    }

    /// Parse the rule in `line` into a `CosmeticFilter`. If `debug` is true, the original rule
    /// will be reported in the resulting `CosmeticFilter` struct as well. Use `permission` to
    /// manage the filter's access to scriptlet resources for `+js(...)` injections.
    pub fn parse(
        line: &str,
        debug: bool,
        permission: PermissionMask,
    ) -> Result<CosmeticFilter, CosmeticFilterError> {
        let mut mask = CosmeticFilterMask::NONE;
        if let Some(sharp_index) = find_char(b'#', line.as_bytes()) {
            let after_sharp_index = sharp_index + 1;

            let second_sharp_index = match find_char(b'#', &line.as_bytes()[after_sharp_index..]) {
                Some(i) => i + after_sharp_index,
                None => return Err(CosmeticFilterError::UnsupportedSyntax),
            };

            let mut translate_abp_syntax = false;

            // Consume filter options embedded in the `##` marker:
            let mut between_sharps = &line[after_sharp_index..second_sharp_index];
            if between_sharps.starts_with('@') {
                // Exception marker will always come first.
                if sharp_index == 0 {
                    return Err(CosmeticFilterError::GenericUnhide);
                }
                mask |= CosmeticFilterMask::UNHIDE;
                between_sharps = &between_sharps[1..];
            }
            if between_sharps.starts_with('%') {
                // AdGuard script injection syntax - not supported
                // `#%#` / `#@%#`
                return Err(CosmeticFilterError::UnsupportedSyntax);
            }
            if between_sharps.starts_with('$') {
                // AdGuard `:style` syntax - not supported for now
                // `#$?#` for CSS rules, `#@$?#` — for exceptions
                return Err(CosmeticFilterError::UnsupportedSyntax);
            }
            if between_sharps.starts_with('?') {
                // ABP/ADG extended CSS syntax:
                // - #?# — for element hiding, #@?# — for exceptions
                translate_abp_syntax = true;
                between_sharps = &between_sharps[1..];
            }
            if !between_sharps.is_empty() {
                return Err(CosmeticFilterError::UnsupportedSyntax);
            }

            let suffix_start_index = second_sharp_index + 1;

            let CosmeticFilterLocations {
                entities,
                not_entities,
                hostnames,
                not_hostnames,
            } = if sharp_index > 0 {
                CosmeticFilter::parse_before_sharp(line, sharp_index)?
            } else {
                CosmeticFilterLocations::default()
            };

            let after_sharp = &line[suffix_start_index..].trim();

            if after_sharp.is_empty() {
                return Err(CosmeticFilterError::EmptyRule);
            }

            let (selector, action) = if line.len() - suffix_start_index > 4
                && line[suffix_start_index..].starts_with("+js(")
                && line.ends_with(')')
            {
                if sharp_index == 0 {
                    return Err(CosmeticFilterError::GenericScriptInject);
                }
                let args = &line[suffix_start_index + 4..line.len() - 1];
                if crate::resources::parse_scriptlet_args(args).is_none() {
                    return Err(CosmeticFilterError::InvalidScriptletArgs);
                }
                mask |= CosmeticFilterMask::SCRIPT_INJECT;
                (
                    // TODO: overloading `CssSelector` here is not ideal.
                    vec![CosmeticFilterOperator::CssSelector(String::from(
                        &line[suffix_start_index + 4..line.len() - 1],
                    ))],
                    None,
                )
            } else {
                let (selector, action) = CosmeticFilter::parse_after_sharp_nonscript(after_sharp)?;
                let validated_selector = validate_css_selector(selector, translate_abp_syntax)?;
                if sharp_index == 0 && action.is_some() {
                    return Err(CosmeticFilterError::GenericAction);
                }
                (validated_selector, action)
            };

            if (not_entities.is_some() || not_hostnames.is_some())
                && mask.contains(CosmeticFilterMask::UNHIDE)
            {
                return Err(CosmeticFilterError::DoubleNegation);
            }

            let this = Self {
                entities,
                hostnames,
                mask,
                not_entities,
                not_hostnames,
                raw_line: if debug {
                    Some(Box::new(String::from(line)))
                } else {
                    None
                },
                selector,
                action,
                permission,
            };

            if !this.has_hostname_constraint() && this.plain_css_selector().is_none() {
                return Err(CosmeticFilterError::GenericAction);
            }

            Ok(this)
        } else {
            Err(CosmeticFilterError::MissingSharp)
        }
    }

    /// Any cosmetic filter rule that specifies (possibly negated) hostnames or entities has a
    /// hostname constraint.
    pub fn has_hostname_constraint(&self) -> bool {
        self.hostnames.is_some()
            || self.entities.is_some()
            || self.not_entities.is_some()
            || self.not_hostnames.is_some()
    }

    /// In general, adding a hostname or entity to a rule *increases* the number of situations in
    /// which it applies. However, if a specific rule only has negated hostnames or entities, it
    /// technically should apply to any hostname which does not match a negation.
    ///
    /// See: <https://github.com/chrisaljoudi/uBlock/issues/145>
    ///
    /// To account for this inconsistency, this method will generate and return the corresponding
    /// 'hidden' generic rule if one applies.
    ///
    /// Note that this behavior is not applied to script injections or rules with actions.
    pub fn hidden_generic_rule(&self) -> Option<CosmeticFilter> {
        if self.hostnames.is_some() || self.entities.is_some() {
            None
        } else if (self.not_hostnames.is_some() || self.not_entities.is_some())
            && (self.action.is_none() && !self.mask.contains(CosmeticFilterMask::SCRIPT_INJECT))
        {
            let mut generic_rule = self.clone();
            generic_rule.not_hostnames = None;
            generic_rule.not_entities = None;
            Some(generic_rule)
        } else {
            None
        }
    }
}

/// Returns a slice of `hostname` up to and including the segment that overlaps with the first
/// segment of `domain`, which has the effect of stripping ".com", ".co.uk", etc., as well as the
/// public suffix itself.
fn get_hostname_without_public_suffix<'a>(
    hostname: &'a str,
    domain: &str,
) -> Option<(&'a str, &'a str)> {
    let index_of_dot = find_char(b'.', domain.as_bytes());

    if let Some(index_of_dot) = index_of_dot {
        let public_suffix = &domain[index_of_dot + 1..];
        Some((
            &hostname[0..hostname.len() - public_suffix.len() - 1],
            &hostname[hostname.len() - domain.len() + index_of_dot + 1..],
        ))
    } else {
        None
    }
}

/// Given a hostname and the indices of an end position and the start of the domain, returns a
/// `Vec` of hashes of all subdomains the hostname falls under, ordered from least to most
/// specific.
///
/// Check the `label_hashing` tests for examples.
fn get_hashes_from_labels(hostname: &str, end: usize, start_of_domain: usize) -> Vec<Hash> {
    let mut hashes = vec![];
    if end == 0 {
        return hashes;
    }
    let mut dot_ptr = start_of_domain;

    while let Some(dot_index) = find_char_reverse(b'.', &hostname.as_bytes()[..dot_ptr]) {
        dot_ptr = dot_index;
        hashes.push(crate::utils::fast_hash(&hostname[dot_ptr + 1..end]));
    }

    hashes.push(crate::utils::fast_hash(&hostname[..end]));

    hashes
}

/// Returns a `Vec` of the hashes of all segments of `hostname` that may match an
/// entity-constrained rule.
pub(crate) fn get_entity_hashes_from_labels(hostname: &str, domain: &str) -> Vec<Hash> {
    if let Some((hostname_without_public_suffix, public_suffix)) =
        get_hostname_without_public_suffix(hostname, domain)
    {
        let mut hashes = get_hashes_from_labels(
            hostname_without_public_suffix,
            hostname_without_public_suffix.len(),
            hostname_without_public_suffix.len(),
        );
        hashes.push(crate::utils::fast_hash(public_suffix));
        hashes
    } else {
        vec![]
    }
}

/// Returns a `Vec` of the hashes of all segments of `hostname` that may match a
/// hostname-constrained rule.
pub(crate) fn get_hostname_hashes_from_labels(hostname: &str, domain: &str) -> Vec<Hash> {
    get_hashes_from_labels(hostname, hostname.len(), hostname.len() - domain.len())
}

mod css_validation {
    use super::{CosmeticFilterError, CosmeticFilterOperator};

    pub fn validate_css_selector(
        selector: &str,
        _accept_abp_selectors: bool,
    ) -> Result<Vec<CosmeticFilterOperator>, CosmeticFilterError> {
        Ok(vec![CosmeticFilterOperator::CssSelector(
            selector.to_string(),
        )])
    }

    pub fn is_valid_css_style(_style: &str) -> bool {
        true
    }
}
