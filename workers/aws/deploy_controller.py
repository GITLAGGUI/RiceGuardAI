"""Deploy one bounded IAM-protected inference controller, without enabling uploads.

The function URL requires AWS IAM SigV4 and then a separate HMAC signature.
This helper installs a narrowly scoped IAM access key in Supabase Edge, never
prints either secret, and refuses implicit credential rotation.
"""

import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.exceptions import ClientError
from botocore.credentials import Credentials

from deploy_worker import ACCOUNT, BUCKET, NAME, PREFIX, REGION, allow, role

CONTROL = "riceguard-private-inference-control"
CALLER = "riceguard-supabase-inference-dispatch"
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
session = boto3.Session(region_name=REGION)


def deploy():
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    if session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
        raise RuntimeError("Credit reserve below the deployment gate")
    lam = session.client("lambda")
    existing = None
    try:
        existing = lam.get_function(FunctionName=CONTROL)
    except lam.exceptions.ResourceNotFoundException:
        pass
    if existing:
        try:
            lam.get_function_url_config(FunctionName=CONTROL)
            raise RuntimeError("Controller URL already exists; refusing to rotate live credentials implicitly")
        except lam.exceptions.ResourceNotFoundException:
            # Recover only the earlier partial creation: no URL or dispatcher
            # credential existed, so no website request could reach it.
            pass
    archive = io.BytesIO()
    source = (ROOT / "website_controller.py").read_bytes()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("website_controller.py", source)
    arn = role(CONTROL + "-role", "lambda.amazonaws.com", [
        allow(["logs:CreateLogStream", "logs:PutLogEvents"], f"arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{CONTROL}:*"),
        allow(["s3:GetObject", "s3:PutObject"], f"arn:aws:s3:::{BUCKET}/{PREFIX}/jobs/*"),
        allow(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], f"arn:aws:s3:::{BUCKET}/{PREFIX}/control/dispatch.lock"),
        {**allow("s3:ListBucket", f"arn:aws:s3:::{BUCKET}"),
            "Condition": {"StringLike": {"s3:prefix": f"{PREFIX}/jobs/*"}}},
        allow("batch:SubmitJob", [f"arn:aws:batch:{REGION}:{ACCOUNT}:job-queue/{NAME}",
                                  f"arn:aws:batch:{REGION}:{ACCOUNT}:job-definition/{NAME}:3"]),
        allow("batch:DescribeJobs", f"arn:aws:batch:{REGION}:{ACCOUNT}:job/*"),
        allow("batch:ListJobs", f"arn:aws:batch:{REGION}:{ACCOUNT}:job-queue/{NAME}"),
        allow("freetier:GetAccountPlanState", "*"),
    ])
    logs = session.client("logs")
    try:
        logs.create_log_group(logGroupName=f"/aws/lambda/{CONTROL}", tags={"Project": "RiceGuard"})
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=f"/aws/lambda/{CONTROL}", retentionInDays=7)
    if existing:
        config = lam.get_function_configuration(FunctionName=CONTROL)
        secret = config["Environment"]["Variables"]["RICEGUARD_DISPATCH_SECRET"]
        lam.update_function_code(FunctionName=CONTROL, ZipFile=archive.getvalue(), Publish=True)
        lam.get_waiter("function_updated").wait(FunctionName=CONTROL)
    else:
        secret = secrets.token_urlsafe(48)
        for attempt in range(6):
            try:
                lam.create_function(FunctionName=CONTROL, Runtime="python3.12", Role=arn,
                    Handler="website_controller.handler", Code={"ZipFile": archive.getvalue()},
                    Description="IAM- and HMAC-gated private two-specialist photo inference controller",
                    Timeout=300, MemorySize=1024, EphemeralStorage={"Size": 1024},
                    Environment={"Variables": {
                        "RICEGUARD_DISPATCH_SECRET": secret,
                        "RICEGUARD_CALLBACK_URL": "https://pekowozxnyyeskymjxyx.supabase.co/functions/v1/worker-callback",
                    }}, Tags={"Project": "RiceGuard"}, Publish=True)
                break
            except ClientError as error:
                if "cannot be assumed" not in str(error).lower() or attempt == 5:
                    raise
                time.sleep(5)
    url = lam.create_function_url_config(FunctionName=CONTROL, AuthType="AWS_IAM")["FunctionUrl"]
    iam = session.client("iam")
    identity = iam.create_user(UserName=CALLER, Tags=[{"Key": "Project", "Value": "RiceGuard"}])["User"]
    policy = {"Version": "2012-10-17", "Statement": [
        allow(["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"],
              f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{CONTROL}"),
    ]}
    iam.put_user_policy(UserName=CALLER, PolicyName="InvokeOnlyRiceGuardPrivateInferenceUrl", PolicyDocument=json.dumps(policy))
    lam.add_permission(FunctionName=CONTROL, StatementId="ScopedCallerFunctionUrl",
        Action="lambda:InvokeFunctionUrl", Principal=identity["Arn"], FunctionUrlAuthType="AWS_IAM")
    lam.add_permission(FunctionName=CONTROL, StatementId="ScopedCallerInvokeViaUrl",
        Action="lambda:InvokeFunction", Principal=identity["Arn"], InvokedViaFunctionUrl=True)
    key = iam.create_access_key(UserName=CALLER)["AccessKey"]
    # Lambda now has one URL and a bounded concurrent invocation. Install the
    # matching Edge secrets without exposing the value in a tool response.
    env = dict(os.environ)
    env["SEND_SMS_HOOK_SECRETS"] = "v1,whsec_" + __import__("base64").b64encode(
        b"local-cli-placeholder-secret-not-for-deployment").decode()
    command = ["supabase", "secrets", "set", f"AWS_DISPATCH_URL={url}",
        f"AWS_DISPATCH_SECRET={secret}", f"AWS_ACCESS_KEY_ID={key['AccessKeyId']}",
        f"AWS_SECRET_ACCESS_KEY={key['SecretAccessKey']}", "--workdir", str(REPO)]
    completed = subprocess.run(command, cwd=REPO, env=env, capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError("Controller created but Supabase secret installation failed; do not enable dispatch")
    # An unsigned request must be denied by IAM before Lambda invocation.
    for attempt in range(12):
        try:
            with urlopen(Request(url, data=b'{}', headers={"Content-Type": "application/json"}), timeout=15):
                raise RuntimeError("Unsigned controller request was accepted")
        except HTTPError as error:
            if error.code == 403:
                break
            if attempt == 11:
                raise RuntimeError(f"Controller rejected the smoke request with HTTP {error.code}, expected 403")
        time.sleep(5)
    else:
        raise RuntimeError("Controller did not reject unsigned calls")
    # IAM-valid but HMAC-unsigned must be rejected by the application itself.
    request = AWSRequest(method="POST", url=url, data=b'{}', headers={"Content-Type": "application/json"})
    SigV4Auth(Credentials(key["AccessKeyId"], key["SecretAccessKey"]), "lambda", REGION).add_auth(request)
    for attempt in range(7):
        try:
            with urlopen(Request(url, data=b'{}', headers=dict(request.headers), method="POST"), timeout=30):
                raise RuntimeError("Application accepted a request without its HMAC")
        except HTTPError as error:
            if error.code == 401:
                break
            if error.code != 403 or attempt == 6:
                raise RuntimeError(f"Signed HMAC-negative test returned HTTP {error.code}, expected 401")
        time.sleep(10)
    print(json.dumps({"deployed": True, "function": CONTROL, "unsigned_http_status": 403,
                      "iam_signed_without_hmac_http_status": 401, "caller_arn": identity["Arn"],
                      "global_s3_dispatch_lock": True, "website_uploads_enabled": False,
                      "source_sha256": hashlib.sha256(source).hexdigest()}))


if __name__ == "__main__":
    deploy()
