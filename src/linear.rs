use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct LinearIssue {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse {
    data: Option<GraphQlData>,
    errors: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlData {
    viewer: Viewer,
}

#[derive(Debug, Deserialize)]
struct Viewer {
    #[serde(rename = "assignedIssues")]
    assigned_issues: IssueConnection,
}

#[derive(Debug, Deserialize)]
struct IssueConnection {
    nodes: Vec<LinearIssue>,
}

pub struct LinearClient {
    client: Client,
    api_key: String,
}

impl LinearClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
        }
    }

    pub async fn fetch_todo_tasks(&self) -> Result<Vec<LinearIssue>, Box<dyn std::error::Error + Send + Sync>> {
        let query = r#"
            query {
                viewer {
                    assignedIssues(filter: { state: { type: { eq: "unstarted" } } }) {
                        nodes {
                            id
                            title
                            description
                            url
                        }
                    }
                }
            }
        "#;

        let res = self.client
            .post("https://api.linear.app/graphql")
            .header("Authorization", &self.api_key)
            .json(&json!({ "query": query }))
            .send()
            .await?;

        let body = res.text().await?;
        let parsed: GraphQlResponse = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(e) => {
                return Err(format!("Failed to parse response: {}. Body: {}", e, body).into());
            }
        };

        if let Some(errors) = parsed.errors {
            return Err(format!("GraphQL API returned errors: {:?}", errors).into());
        }

        if let Some(data) = parsed.data {
            Ok(data.viewer.assigned_issues.nodes)
        } else {
            Err(format!("No data returned from Linear. Body: {}", body).into())
        }
    }

    // In a full implementation we would use a mutation to change the state.
    // For now, we will add an instruction for opencode to move it to 'Ready to Review'.
}
