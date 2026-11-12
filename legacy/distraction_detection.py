import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.preprocessing import StandardScaler

# Dummy dataset creation
data = pd.DataFrame({
    'focus_level': [7, 4, 6, 8, 3, 9, 5, 2, 1, 10],
    'time_spent_on_task': [120, 60, 110, 140, 45, 150, 90, 30, 20, 160],
    'tab_switches': [2, 10, 4, 1, 15, 0, 6, 20, 25, 0],
    'distraction_level': [0, 1, 0, 0, 1, 0, 1, 1, 1, 0]
})

# Features and labels
X = data[['focus_level', 'time_spent_on_task', 'tab_switches']]
y = data['distraction_level']

# Data preprocessing
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Split the data
X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)

# Train the model
model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

# Predictions
y_pred = model.predict(X_test)

# Evaluate the model
accuracy = accuracy_score(y_test, y_pred)
report = classification_report(y_test, y_pred)

print(f"Model Accuracy: {accuracy}")
print(f"Classification Report:\n{report}")
