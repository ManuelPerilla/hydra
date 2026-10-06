use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use sha1::Sha1;
use std::{
    env,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const ENCODE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');
const ENDPOINT: &str = "https://api.x.com/2/tweets";

// Secrets have no Debug implementation, never appear in exceptions or logs.
pub struct Credentials {
    consumer_key: String,
    consumer_secret: String,
    access_token: String,
    access_secret: String,
}

impl Credentials {
    pub fn from_env() -> Result<Self> {
        fn secret(name: &str) -> Result<String> {
            let value = env::var(name)
                .with_context(|| format!("{name} is required when HYDRA_X_ENABLED=true"))?;
            ensure!(!value.trim().is_empty(), "{name} must not be empty");
            Ok(value)
        }
        Ok(Self {
            consumer_key: secret("HYDRA_X_CONSUMER_KEY")?,
            consumer_secret: secret("HYDRA_X_CONSUMER_SECRET")?,
            access_token: secret("HYDRA_X_ACCESS_TOKEN")?,
            access_secret: secret("HYDRA_X_ACCESS_SECRET")?,
        })
    }

    pub async fn publish(&self, draft: &str) -> Result<()> {
        // Never retry this paid non-idempotent call: an uncertain response could
        // already have published a post. The stored draft survives an X outage.
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs()
            .to_string();
        let mut params = vec![
            ("oauth_consumer_key".into(), self.consumer_key.clone()),
            ("oauth_nonce".into(), nonce),
            ("oauth_signature_method".into(), "HMAC-SHA1".into()),
            ("oauth_timestamp".into(), timestamp),
            ("oauth_token".into(), self.access_token.clone()),
            ("oauth_version".into(), "1.0".into()),
        ];
        let signature = signature(
            "POST",
            ENDPOINT,
            &params,
            &self.consumer_secret,
            &self.access_secret,
        )?;
        params.push(("oauth_signature".into(), signature));
        let auth = format!(
            "OAuth {}",
            params
                .iter()
                .map(|(key, value)| format!("{}=\"{}\"", encode(key), encode(value)))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let response = client
            .post(ENDPOINT)
            .header(reqwest::header::AUTHORIZATION, auth)
            .json(&serde_json::json!({"text":draft}))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("X publishing transport failed"))?;
        ensure!(
            response.status().is_success(),
            "X publishing rejected ({})",
            response.status().as_u16()
        );
        Ok(())
    }
}

fn encode(value: &str) -> String {
    utf8_percent_encode(value, ENCODE).to_string()
}

fn signature(
    method: &str,
    endpoint: &str,
    params: &[(String, String)],
    consumer_secret: &str,
    access_secret: &str,
) -> Result<String> {
    let mut encoded: Vec<_> = params
        .iter()
        .map(|(key, value)| (encode(key), encode(value)))
        .collect();
    encoded.sort();
    let normalized = encoded
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    let base = format!(
        "{}&{}&{}",
        method.to_uppercase(),
        encode(endpoint),
        encode(&normalized)
    );
    let key = format!("{}&{}", encode(consumer_secret), encode(access_secret));
    let mut hmac = Hmac::<Sha1>::new_from_slice(key.as_bytes())?;
    hmac.update(base.as_bytes());
    Ok(STANDARD.encode(hmac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_oauth_rfc_5849_signature_vector() {
        let params = [
            ("file", "vacation.jpg"),
            ("size", "original"),
            ("oauth_consumer_key", "dpf43f3p2l4k3l03"),
            ("oauth_nonce", "kllo9940pd9333jh"),
            ("oauth_signature_method", "HMAC-SHA1"),
            ("oauth_timestamp", "1191242096"),
            ("oauth_token", "nnch734d00sl2jdk"),
            ("oauth_version", "1.0"),
        ]
        .map(|(key, value)| (key.to_owned(), value.to_owned()));
        let signed = signature(
            "GET",
            "http://photos.example.net/photos",
            &params,
            "kd94hf93k423kf44",
            "pfkkdhi9sl3r4s00",
        )
        .unwrap();
        assert_eq!(signed, "tR3+Ty81lMeYAr/Fid0kMTYa/WM=");
    }
    #[test]
    fn encodes_oauth_reserved_characters_without_encoding_unreserved() {
        assert_eq!(encode("AZaz09-._~!* /+"), "AZaz09-._~%21%2A%20%2F%2B");
    }
}
