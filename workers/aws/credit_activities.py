"""Small, idempotent AWS credit activities; no public URL or always-on compute.

Uses the existing AWS credential chain. Never logs credentials or creates RDS.
Run with `status`, `budget`, or `lambda`. Rewards are reported, not assumed.
"""
import argparse
import io
import json
import time
import zipfile

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.exceptions import ClientError
import requests

REGION = "us-east-1"
NAME = "riceguard-credit-activity"
ROLE = NAME + "-lambda"
BUDGET = "RiceGuard-no-out-of-pocket-monitor"


def main(action):
    session = boto3.Session(region_name=REGION)
    account = session.client("sts").get_caller_identity()["Account"]
    if account != "342278407276":
        raise RuntimeError("Unexpected AWS account; refusing mutation")
    free = session.client("freetier")
    if action == "budget":
        client = session.client("budgets")
        try:
            client.describe_budget(AccountId=account, BudgetName=BUDGET)
            print("Existing cost monitor preserved")
        except client.exceptions.NotFoundException:
            client.create_budget(AccountId=account, Budget={
                "BudgetName": BUDGET,
                "BudgetType": "COST",
                "TimeUnit": "MONTHLY",
                "BudgetLimit": {"Amount": "0.01", "Unit": "USD"},
                "CostTypes": {"IncludeCredit": True, "IncludeRefund": True,
                              "IncludeTax": True, "UseAmortized": False},
            })
            print("Created free monthly net-cost monitor; not a spending cap")
        result = client.describe_budget(AccountId=account, BudgetName=BUDGET)["Budget"]
        print(json.dumps({k: result.get(k) for k in ("BudgetName", "BudgetLimit", "CalculatedSpend")}))
    elif action == "lambda":
        iam = session.client("iam")
        try:
            role = iam.get_role(RoleName=ROLE)["Role"]
        except iam.exceptions.NoSuchEntityException:
            role = iam.create_role(RoleName=ROLE,
                Description="RiceGuard credit activity; Lambda trust only, no data permissions",
                AssumeRolePolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{
                    "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                    "Action": "sts:AssumeRole"}]}),
                Tags=[{"Key": "Project", "Value": "RiceGuard"},
                      {"Key": "Purpose", "Value": "credit-activity"}])["Role"]
        client = session.client("lambda")
        try:
            client.get_function(FunctionName=NAME)
            print("Existing activity function preserved")
        except client.exceptions.ResourceNotFoundException:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
                bundle.writestr("app.py", 'def handler(event, context):\n    return {"statusCode": 200, "headers": {"Content-Type": "text/html"}, "body": "<!doctype html><title>RiceGuard</title><h1>RiceGuard private activity app</h1>"}\n')
            for attempt in range(6):
                try:
                    client.create_function(FunctionName=NAME, Runtime="python3.12",
                        Role=role["Arn"], Handler="app.handler",
                        Code={"ZipFile": archive.getvalue()}, Timeout=3, MemorySize=128,
                        Description="IAM-authenticated credit activity. No models or survey data.",
                        Tags={"Project": "RiceGuard", "Purpose": "credit-activity"})
                    break
                except ClientError as error:
                    if "cannot be assumed" not in str(error) or attempt == 5:
                        raise
                    time.sleep(5)
            client.get_waiter("function_active_v2").wait(FunctionName=NAME,
                WaiterConfig={"Delay": 2, "MaxAttempts": 20})
        # Account IAM users, not anonymous visitors, may invoke this URL.
        try:
            config = client.get_function_url_config(FunctionName=NAME)
        except client.exceptions.ResourceNotFoundException:
            config = client.create_function_url_config(FunctionName=NAME, AuthType="AWS_IAM")
        if config["AuthType"] != "AWS_IAM":
            raise RuntimeError("Unexpected public activity URL; refusing invocation")
        request = AWSRequest(method="GET", url=config["FunctionUrl"])
        SigV4Auth(session.get_credentials().get_frozen_credentials(), "lambda", REGION).add_auth(request)
        response = requests.get(config["FunctionUrl"], headers=dict(request.headers), timeout=20)
        response.raise_for_status()
        print(json.dumps({"function": NAME, "auth": "AWS_IAM", "http_status": response.status_code,
                          "app_response_verified": "RiceGuard private activity app" in response.text,
                          "provisioned_concurrency": 0}))
    state = free.get_account_plan_state()
    print(json.dumps({k: v for k, v in state.items() if k not in ("ResponseMetadata", "accountId")}, default=str))
    print(json.dumps(free.list_account_activities()["activities"], default=str))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("status", "budget", "lambda"))
    main(parser.parse_args().action)
