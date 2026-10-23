"""Pin the existing private controller to the tested worker without rotating credentials.

The website dispatch flag remains off. The old Batch revision stays authorized
for rollback, and the Lambda URL, HMAC secret, and scoped caller key are intact.
"""

import base64
import hashlib
import io
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

import boto3

from deploy_controller import ACCOUNT, CONTROL, REGION, ROOT
from website_controller import JOB_DEFINITION, QUEUE


ROLE = "riceguard-private-inference-control-role"
POLICY = "ScopedRiceGuardAccess"
REVISION = "4"
MIN_REMAINING_CREDITS_USD = 100


def main():
    session = boto3.Session(region_name=REGION)
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    if session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < MIN_REMAINING_CREDITS_USD:
        raise RuntimeError("Credit reserve reached; refusing controller update")
    if JOB_DEFINITION != f"{QUEUE}:{REVISION}":
        raise RuntimeError("Controller does not pin the reviewed worker revision")
    batch = session.client("batch")
    definitions = batch.describe_job_definitions(jobDefinitionName=QUEUE, status="ACTIVE")["jobDefinitions"]
    if not any(item["revision"] == int(REVISION) for item in definitions):
        raise RuntimeError("Reviewed worker revision is not active")
    lam = session.client("lambda")
    config = lam.get_function_configuration(FunctionName=CONTROL)
    url = lam.get_function_url_config(FunctionName=CONTROL)
    if url["AuthType"] != "AWS_IAM" or config["Role"].split("/")[-1] != ROLE:
        raise RuntimeError("Existing private controller identity or URL policy changed")
    iam = session.client("iam")
    policy = iam.get_role_policy(RoleName=ROLE, PolicyName=POLICY)["PolicyDocument"]
    statements = [item for item in policy["Statement"] if "batch:SubmitJob" in item.get("Action", [])]
    if len(statements) != 1 or statements[0]["Effect"] != "Allow":
        raise RuntimeError("Unexpected Batch submission policy structure")
    expected_queue = f"arn:aws:batch:{REGION}:{ACCOUNT}:job-queue/{QUEUE}"
    previous = f"arn:aws:batch:{REGION}:{ACCOUNT}:job-definition/{QUEUE}:3"
    updated = f"arn:aws:batch:{REGION}:{ACCOUNT}:job-definition/{QUEUE}:{REVISION}"
    resources = statements[0]["Resource"]
    if set(resources) not in ({expected_queue, previous}, {expected_queue, previous, updated}):
        raise RuntimeError("Batch policy contains an unexpected resource")
    if updated not in resources:
        statements[0]["Resource"] = [expected_queue, previous, updated]
        iam.put_role_policy(RoleName=ROLE, PolicyName=POLICY, PolicyDocument=json.dumps(policy))
    source = (ROOT / "website_controller.py").read_bytes()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("website_controller.py", source)
    intended_code_sha = base64.b64encode(hashlib.sha256(archive.getvalue()).digest()).decode()
    if config["CodeSha256"] != intended_code_sha:
        lam.update_function_code(FunctionName=CONTROL, ZipFile=archive.getvalue(), Publish=True,
                                 RevisionId=config["RevisionId"])
        lam.get_waiter("function_updated").wait(FunctionName=CONTROL)
    current = lam.get_function_configuration(FunctionName=CONTROL)
    if current["CodeSha256"] != intended_code_sha or lam.get_function_url_config(FunctionName=CONTROL)["FunctionUrl"] != url["FunctionUrl"]:
        raise RuntimeError("Controller code or existing URL did not verify")
    policy_after = iam.get_role_policy(RoleName=ROLE, PolicyName=POLICY)["PolicyDocument"]
    if updated not in next(item for item in policy_after["Statement"] if "batch:SubmitJob" in item.get("Action", []))["Resource"]:
        raise RuntimeError("New worker revision lacks controller permission")
    try:
        with urlopen(Request(url["FunctionUrl"], data=b"{}", headers={"Content-Type": "application/json"}), timeout=20):
            raise RuntimeError("Unsigned controller request was accepted")
    except HTTPError as error:
        if error.code != 403:
            raise RuntimeError(f"Unsigned controller request returned {error.code}, expected 403") from error
    print(json.dumps({"controller": CONTROL, "job_definition": JOB_DEFINITION,
                      "iam_url_still_private": True, "credentials_rotated": False,
                      "website_uploads_enabled": False, "rollback_revision_preserved": True,
                      "source_sha256": hashlib.sha256(source).hexdigest()}))


if __name__ == "__main__":
    main()
