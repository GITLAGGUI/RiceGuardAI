"""Update the existing private controller without rotating credentials or URLs."""

import hashlib
import hmac
import io
import json
from pathlib import Path
import zipfile

import boto3

from deploy_worker import ACCOUNT, BUCKET, PREFIX, REGION, allow, role
from deploy_controller import CONTROL


def main():
    session = boto3.Session(region_name=REGION)
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    remaining = session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"]
    if remaining < 20:
        raise RuntimeError("Credit reserve below the controller update gate")
    lam = session.client("lambda")
    current = lam.get_function_configuration(FunctionName=CONTROL)
    secret = current["Environment"]["Variables"]["RICEGUARD_DISPATCH_SECRET"]
    role(CONTROL + "-role", "lambda.amazonaws.com", [
        allow(["logs:CreateLogStream", "logs:PutLogEvents"],
              f"arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{CONTROL}:*"),
        allow(["s3:GetObject", "s3:PutObject"], f"arn:aws:s3:::{BUCKET}/{PREFIX}/jobs/*"),
        allow("s3:GetObject", [f"arn:aws:s3:::{BUCKET}/{PREFIX}/models/*",
                               f"arn:aws:s3:::{BUCKET}/{PREFIX}/bundles/*"]),
        allow(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
              f"arn:aws:s3:::{BUCKET}/{PREFIX}/control/dispatch.lock"),
        {**allow("s3:ListBucket", f"arn:aws:s3:::{BUCKET}"),
         "Condition": {"StringLike": {"s3:prefix": [f"{PREFIX}/jobs/*",
                                                    f"{PREFIX}/models/*",
                                                    f"{PREFIX}/bundles/*"]}}},
        allow("batch:SubmitJob", [f"arn:aws:batch:{REGION}:{ACCOUNT}:job-queue/riceguard-private-inference",
                                  f"arn:aws:batch:{REGION}:{ACCOUNT}:job-definition/riceguard-private-inference:*"]),
        allow("batch:DescribeJobs", f"arn:aws:batch:{REGION}:{ACCOUNT}:job/*"),
        allow("batch:ListJobs", f"arn:aws:batch:{REGION}:{ACCOUNT}:job-queue/riceguard-private-inference"),
        allow("freetier:GetAccountPlanState", "*"),
    ])
    source = (Path(__file__).resolve().parent / "website_controller.py").read_bytes()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("website_controller.py", source)
    lam.update_function_code(FunctionName=CONTROL, ZipFile=archive.getvalue(), Publish=True)
    lam.get_waiter("function_updated").wait(FunctionName=CONTROL)

    body = json.dumps({"action": "signed-pinned-models",
                       "job_id": "11111111-1111-4111-8111-111111111111",
                       "run_id": "rg-controller-smoke"})
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    result = lam.invoke(FunctionName=CONTROL, InvocationType="RequestResponse", Payload=json.dumps({
        "body": body, "headers": {"X-RiceGuard-Signature": signature}, "isBase64Encoded": False,
    }).encode())
    envelope = json.loads(result["Payload"].read())
    response = json.loads(envelope["body"])
    if envelope.get("statusCode") != 200 or set(response.get("model_downloads", {})) != {"BLB", "Brown Spot"}:
        raise RuntimeError("Updated controller failed its private pinned-model smoke test")
    print(json.dumps({"updated": True, "function": CONTROL,
                      "source_sha256": hashlib.sha256(source).hexdigest(),
                      "pinned_model_smoke": True, "remaining_credit_guard_passed": True}))


if __name__ == "__main__":
    main()
