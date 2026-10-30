use enums::error::enum_error::EnumError;
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum SqliteTasksError {
  SqlxError(sqlx::Error),
  EnumError(EnumError),
  InvalidTaskEnum {
    task_id: String,
    column: &'static str,
    value: String,
    source: EnumError,
  },
  //TaskNotFound,
  //TaskAlreadyExists,
  //InvalidTaskStatus,
  //InvalidTaskType,
  //InvalidGenerationProvider,
}

impl Error for SqliteTasksError {
  fn source(&self) -> Option<&(dyn Error + 'static)> {
    match self {
      Self::SqlxError(err) => Some(err),
      Self::EnumError(err) => Some(err),
      Self::InvalidTaskEnum { source, .. } => Some(source),
    }
  }
}

impl Display for SqliteTasksError {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    match self {
      SqliteTasksError::SqlxError(err) => write!(f, "SQLx error: {:?}", err),
      SqliteTasksError::EnumError(err) => write!(f, "Error parsing enum: {:?}", err),
      SqliteTasksError::InvalidTaskEnum { task_id, column, value } => write!(
        f,
        "Task {task_id} has unsupported value {value:?} in column {column}"
      ),
    }
  }
}

pub(crate) fn decode_task_enum<T>(
  task_id: &str,
  column: &'static str,
  value: &str,
  decode: impl FnOnce(&str) -> Result<T, EnumError>,
) -> Result<T, SqliteTasksError> {
  decode(value).map_err(|source| SqliteTasksError::InvalidTaskEnum {
    task_id: task_id.to_owned(),
    column,
    value: value.to_owned(),
    source,
  })
}

impl From<sqlx::Error> for SqliteTasksError {
  fn from(err: sqlx::Error) -> Self {
    SqliteTasksError::SqlxError(err)
  }
}

impl From<EnumError> for SqliteTasksError {
  fn from(err: EnumError) -> Self {
    SqliteTasksError::EnumError(err)
  }
}

#[cfg(test)]
mod tests {
  use super::{decode_task_enum, SqliteTasksError};
  use enums::tauri::tasks::task_status::TaskStatus;

  #[test]
  fn invalid_persisted_enum_reports_the_task_and_column() {
    let error = decode_task_enum(
      "task_123",
      "task_status",
      "future_status",
      TaskStatus::from_str,
    )
    .unwrap_err();

    assert!(matches!(
      error,
      SqliteTasksError::InvalidTaskEnum {
        task_id,
        column: "task_status",
        value,
        ..
      } if task_id == "task_123" && value == "future_status"
    ));
  }
}
