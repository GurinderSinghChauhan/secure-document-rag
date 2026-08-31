from dataclasses import dataclass


SCHEMA_VERSION = 2


@dataclass(frozen=True)
class DocumentSchema:
    key: str
    label: str
    fields: tuple[str, ...]


@dataclass(frozen=True)
class IndustrySchema:
    key: str
    label: str
    description: str
    document_types: tuple[DocumentSchema, ...]


def _document(key: str, label: str, fields: str) -> DocumentSchema:
    return DocumentSchema(key=key, label=label, fields=tuple(value.strip() for value in fields.split(",")))


INDUSTRIES: tuple[IndustrySchema, ...] = (
    IndustrySchema(
        key="field_service",
        label="Field Service",
        description="HVAC, plumbing, electrical, equipment, and customer service operations.",
        document_types=(
            _document("field_service.service_invoice", "Service Invoice", "invoice_number,invoice_date,customer_name,service_address,technician_name,equipment_type,equipment_brand,model_number,serial_number,problem_description,work_performed,parts_used,labor_hours,labor_cost,parts_cost,tax,total_amount,payment_status"),
            _document("field_service.installation_contract", "Installation Contract", "contract_number,customer_name,installation_address,contract_date,equipment_type,manufacturer,model_number,serial_number,capacity,seer_rating,installation_date,equipment_cost,labor_cost,total_contract_value,deposit,balance_due,warranty_terms,customer_signature,contractor_signature"),
            _document("field_service.work_order", "Service Report / Work Order", "work_order_number,customer_name,service_address,service_date,technician,equipment_type,manufacturer,model_number,serial_number,reported_problem,diagnosis,work_performed,parts_replaced,recommendations,next_service_date,status"),
            _document("field_service.maintenance_agreement", "Maintenance Agreement", "agreement_number,customer_name,property_address,start_date,expiration_date,renewal_type,equipment_covered,service_frequency,annual_price,payment_terms,cancellation_terms,status"),
            _document("field_service.equipment_warranty", "Equipment Warranty", "manufacturer,equipment_type,model_number,serial_number,installation_date,warranty_start,warranty_end,parts_warranty,labor_warranty,compressor_warranty,warranty_exclusions"),
            _document("field_service.estimate", "Estimate / Quote", "estimate_number,customer_name,estimate_date,valid_until,service_address,scope_of_work,equipment,material_cost,labor_cost,discount,tax,estimated_total,financing_terms,status"),
            _document("field_service.equipment_manual", "Equipment Manual", "manufacturer,product_name,model_numbers,equipment_category,specifications,voltage,capacity,installation_requirements,maintenance_interval,error_codes,troubleshooting_procedures,parts_numbers,safety_warnings"),
        ),
    ),
    IndustrySchema(
        key="contract_intelligence",
        label="Contract Intelligence",
        description="Corporate legal agreements, obligations, renewals, and commercial risk.",
        document_types=(
            _document("contract_intelligence.msa", "Master Service Agreement", "contract_id,party_1,party_2,effective_date,expiration_date,contract_value,payment_terms,term_length,auto_renewal,renewal_period,termination_notice_days,termination_for_cause,termination_for_convenience,governing_law,jurisdiction,liability_cap,indemnification,confidentiality,insurance_requirements,dispute_resolution"),
            _document("contract_intelligence.sow", "Statement of Work", "sow_number,parent_contract,customer,vendor,start_date,end_date,scope,deliverables,milestones,pricing_model,total_value,payment_schedule,acceptance_criteria,project_manager,change_control_terms"),
            _document("contract_intelligence.nda", "NDA", "agreement_id,disclosing_party,receiving_party,effective_date,expiration_date,confidentiality_period,definition_confidential_information,permitted_use,exclusions,return_destroy_requirement,governing_law"),
            _document("contract_intelligence.vendor_agreement", "Vendor Agreement", "vendor_name,agreement_number,effective_date,expiration_date,services,annual_value,payment_terms,sla,insurance_requirement,renewal_terms,termination_terms,liability,data_protection_requirements"),
            _document("contract_intelligence.lease", "Lease", "landlord,tenant,property_address,lease_start,lease_end,monthly_rent,security_deposit,rent_escalation,renewal_option,maintenance_responsibility,insurance_requirement,termination_terms"),
            _document("contract_intelligence.amendment", "Amendment", "amendment_number,parent_contract,effective_date,parties,modified_sections,previous_value,new_value,new_expiration_date,description_of_changes"),
        ),
    ),
    IndustrySchema(
        key="litigation",
        label="Legal / Litigation",
        description="Cases, filings, testimony, evidence, rulings, and deadlines.",
        document_types=(
            _document("litigation.complaint", "Complaint / Petition", "case_number,court,filing_date,plaintiff,defendant,attorneys,causes_of_action,allegations,damages_requested,jury_demand,judge"),
            _document("litigation.answer", "Answer", "case_number,filing_party,filing_date,admitted_allegations,denied_allegations,affirmative_defenses,counterclaims,attorney"),
            _document("litigation.deposition", "Deposition Transcript", "case_number,deponent,deposition_date,attorneys_present,topics,key_statements,admissions,contradictions,exhibits_referenced,page_line_reference"),
            _document("litigation.court_order", "Court Order", "case_number,court,judge,order_date,motion,ruling,requirements,deadlines,sanctions,next_hearing"),
            _document("litigation.motion", "Motion", "case_number,motion_type,filing_party,filing_date,requested_relief,legal_arguments,authorities_cited,hearing_date"),
            _document("litigation.evidence", "Evidence / Exhibit", "exhibit_number,case_number,document_date,document_type,author,recipient,people_mentioned,organizations,key_facts,related_events"),
            _document("litigation.settlement", "Settlement Agreement", "case_number,parties,settlement_date,settlement_amount,payment_schedule,release_terms,confidentiality,non_disparagement,obligations,deadlines"),
        ),
    ),
    IndustrySchema(
        key="healthcare",
        label="Healthcare",
        description="Clinical records and longitudinal observations requiring enhanced privacy controls.",
        document_types=(
            _document("healthcare.patient_registration", "Patient Registration", "patient_id,name,date_of_birth,sex,address,phone,insurance_provider,policy_number,emergency_contact,primary_physician"),
            _document("healthcare.progress_note", "Clinical / Progress Note", "patient_id,visit_date,provider,department,chief_complaint,symptoms,history,vital_signs,assessment,diagnoses,treatment_plan,medications,follow_up"),
            _document("healthcare.lab_report", "Lab Report", "patient_id,collection_date,test_name,result,unit,reference_range,abnormal_flag,ordering_provider,laboratory"),
            _document("healthcare.medication", "Prescription / Medication Record", "patient_id,medication_name,strength,dose,route,frequency,start_date,end_date,prescriber,refills"),
            _document("healthcare.discharge_summary", "Discharge Summary", "patient_id,admission_date,discharge_date,admission_reason,diagnoses,procedures,hospital_course,discharge_medications,discharge_condition,follow_up,provider"),
            _document("healthcare.imaging_report", "Imaging Report", "patient_id,study_date,modality,body_part,ordering_provider,radiologist,findings,impression,recommendations"),
            _document("healthcare.operative_report", "Operative Report", "patient_id,procedure_date,procedure,surgeon,assistants,preoperative_diagnosis,postoperative_diagnosis,anesthesia,findings,complications,estimated_blood_loss"),
        ),
    ),
    IndustrySchema(
        key="insurance",
        label="Insurance / Claims",
        description="Policies, losses, inspections, estimates, settlements, and claim risk.",
        document_types=(
            _document("insurance.policy", "Insurance Policy", "policy_number,insured_name,policy_type,effective_date,expiration_date,coverage_limits,deductible,premium,covered_perils,exclusions,endorsements,agent"),
            _document("insurance.claim_form", "Claim Form", "claim_number,policy_number,claimant,loss_date,reported_date,loss_location,claim_type,incident_description,claimed_amount,injuries,property_damage"),
            _document("insurance.adjuster_report", "Adjuster Report", "claim_number,adjuster,inspection_date,damage_description,cause_of_loss,estimated_damage,coverage_assessment,recommended_payment,fraud_indicators,recommendations"),
            _document("insurance.repair_estimate", "Repair Estimate", "claim_number,contractor,estimate_date,labor_cost,material_cost,equipment_cost,tax,total_estimate,scope_of_work"),
            _document("insurance.damage_inspection", "Damage Inspection", "claim_number,inspection_date,inspector,property_address,damage_type,affected_areas,severity,estimated_cost,recommended_action"),
            _document("insurance.settlement_letter", "Settlement Letter", "claim_number,policy_number,settlement_date,claimed_amount,approved_amount,deductible,payment_amount,denied_amount,denial_reason,release_terms"),
            _document("insurance.denial_letter", "Denial Letter", "claim_number,policy_number,denial_date,denial_reason,policy_clause,appeal_deadline,appeal_process"),
        ),
    ),
    IndustrySchema(
        key="accounts_payable",
        label="Accounts Payable",
        description="Invoices, purchase orders, receipts, credits, and vendor reconciliation.",
        document_types=(
            _document("accounts_payable.invoice", "Invoice", "invoice_number,vendor_name,vendor_address,invoice_date,due_date,po_number,currency,subtotal,discount,tax,shipping,total,amount_due,payment_terms,bank_details"),
            _document("accounts_payable.invoice_line_item", "Invoice Line Item", "invoice_number,line_number,sku,description,quantity,unit,unit_price,discount,tax,line_total"),
            _document("accounts_payable.purchase_order", "Purchase Order", "po_number,vendor,buyer,order_date,delivery_date,ship_to,bill_to,currency,subtotal,tax,total,payment_terms,status"),
            _document("accounts_payable.po_line_item", "PO Line Item", "po_number,line_number,sku,description,ordered_quantity,unit_price,line_total"),
            _document("accounts_payable.receipt", "Receipt / Goods Received Note", "receipt_number,po_number,vendor,received_date,sku,description,ordered_quantity,received_quantity,damaged_quantity,receiver"),
            _document("accounts_payable.credit_memo", "Credit Memo", "credit_memo_number,vendor,original_invoice,issue_date,reason,credit_amount,tax_adjustment,total_credit"),
            _document("accounts_payable.vendor_statement", "Vendor Statement", "vendor,statement_date,invoice_numbers,opening_balance,charges,payments,credits,closing_balance"),
        ),
    ),
    IndustrySchema(
        key="construction",
        label="Construction",
        description="Projects, contracts, change orders, submittals, payments, inspections, and delays.",
        document_types=(
            _document("construction.contract", "Construction Contract", "contract_number,project_name,owner,general_contractor,contractor,start_date,completion_date,contract_value,retainage,payment_terms,scope,liquidated_damages,insurance_requirements"),
            _document("construction.change_order", "Change Order", "change_order_number,project,contract,request_date,description,reason,original_contract_value,change_amount,revised_contract_value,schedule_impact_days,approval_status"),
            _document("construction.rfi", "RFI", "rfi_number,project,submitted_date,submitted_by,assigned_to,subject,question,response,response_date,schedule_impact,cost_impact,status"),
            _document("construction.submittal", "Submittal", "submittal_number,project,specification_section,description,contractor,submitted_date,reviewer,review_date,status,comments"),
            _document("construction.daily_report", "Daily Report", "project,report_date,superintendent,weather,workers_on_site,work_completed,equipment_used,materials_received,delays,incidents,visitors"),
            _document("construction.pay_application", "Pay Application", "application_number,project,contractor,period_start,period_end,original_contract,change_orders,completed_to_date,retainage,previous_payments,current_payment_due"),
            _document("construction.inspection_report", "Inspection Report", "project,inspection_date,inspector,inspection_type,area,findings,deficiencies,corrective_actions,due_date,status"),
        ),
    ),
    IndustrySchema(
        key="manufacturing",
        label="Manufacturing",
        description="Equipment, procedures, maintenance, quality, materials, and production safety.",
        document_types=(
            _document("manufacturing.equipment_manual", "Equipment Manual", "manufacturer,equipment_name,model,serial_range,specifications,operating_limits,maintenance_interval,error_codes,troubleshooting,parts,safety_warnings"),
            _document("manufacturing.sop", "SOP", "sop_number,title,department,version,effective_date,owner,purpose,scope,required_equipment,procedure_steps,safety_requirements,approval"),
            _document("manufacturing.maintenance_work_order", "Maintenance Work Order", "work_order,machine_id,machine_name,reported_date,failure_type,symptoms,technician,diagnosis,repair,parts_used,downtime,completion_date"),
            _document("manufacturing.quality_inspection_report", "Quality Inspection Report", "inspection_id,product,batch,inspection_date,inspector,measurement,specification,actual_value,pass_fail,defects,corrective_action"),
            _document("manufacturing.certificate_of_analysis", "Certificate of Analysis", "certificate_number,product,batch_number,manufacturing_date,test,specification,result,unit,pass_fail,approved_by"),
            _document("manufacturing.safety_data_sheet", "Safety Data Sheet", "product_name,manufacturer,hazards,signal_word,ppe,first_aid,handling,storage,exposure_limits,spill_procedure,firefighting_measures"),
            _document("manufacturing.bill_of_materials", "Bill of Materials", "bom_number,product,revision,component_number,component_name,quantity,unit,manufacturer,supplier"),
        ),
    ),
    IndustrySchema(
        key="banking_lending",
        label="Banking / Mortgage / Lending",
        description="Loan files, borrower finances, credit, income verification, and property valuation.",
        document_types=(
            _document("banking_lending.loan_application", "Loan Application", "application_id,borrower,co_borrower,loan_amount,loan_type,property_address,purchase_price,down_payment,employment,monthly_income,assets,liabilities"),
            _document("banking_lending.bank_statement", "Bank Statement", "borrower,bank_name,account_type,account_last4,statement_start,statement_end,opening_balance,closing_balance,total_deposits,total_withdrawals,average_balance,overdrafts"),
            _document("banking_lending.pay_stub", "Pay Stub", "employee,employer,pay_period_start,pay_period_end,pay_date,gross_pay,net_pay,ytd_gross,taxes,deductions"),
            _document("banking_lending.w2", "W-2", "tax_year,employee,employer,employer_ein,wages,federal_tax_withheld,social_security_wages,medicare_wages,state_wages"),
            _document("banking_lending.tax_return", "Tax Return", "tax_year,taxpayer,filing_status,total_income,agi,taxable_income,total_tax,refund_or_amount_owed"),
            _document("banking_lending.credit_report", "Credit Report", "borrower,report_date,credit_score,accounts,total_debt,monthly_payments,delinquencies,collections,inquiries"),
            _document("banking_lending.appraisal", "Appraisal", "property_address,appraisal_date,appraiser,property_type,square_feet,bedrooms,bathrooms,comparable_sales,appraised_value"),
        ),
    ),
    IndustrySchema(
        key="hr",
        label="HR / Employee Document Intelligence",
        description="Recruiting, employment, performance, policies, compensation, and benefits.",
        document_types=(
            _document("hr.resume", "Resume", "candidate_name,email,phone,location,skills,education,certifications,employers,job_titles,employment_dates,years_experience"),
            _document("hr.offer_letter", "Offer Letter", "employee,job_title,department,manager,start_date,base_salary,bonus,equity,location,employment_type,benefits,acceptance_date"),
            _document("hr.employment_agreement", "Employment Agreement", "employee,employer,effective_date,title,compensation,bonus,termination_terms,confidentiality,ip_assignment,non_solicitation"),
            _document("hr.performance_review", "Performance Review", "employee,manager,review_period,rating,goals,achievements,strengths,improvement_areas,next_period_goals"),
            _document("hr.employee_handbook", "Employee Handbook", "policy_name,policy_category,effective_date,eligibility,requirements,benefits,exceptions,approval_authority"),
            _document("hr.benefits_document", "Benefits Document", "plan_name,provider,plan_year,eligibility,employee_cost,employer_cost,deductible,coverage,limitations"),
        ),
    ),
    IndustrySchema(
        key="property_management",
        label="Property Management / Real Estate",
        description="Leases, rent, maintenance, inspections, vendors, and property insurance.",
        document_types=(
            _document("property_management.lease_agreement", "Lease Agreement", "property,unit,tenant,lease_start,lease_end,monthly_rent,deposit,late_fee,utilities,parking,pets,renewal_terms,notice_period"),
            _document("property_management.rent_invoice", "Rent Invoice", "tenant,property,unit,billing_period,rent,utilities,fees,total_due,due_date,paid_amount,balance"),
            _document("property_management.maintenance_request", "Maintenance Request", "request_id,property,unit,tenant,request_date,category,problem,priority,vendor,scheduled_date,completion_date,cost,status"),
            _document("property_management.inspection_report", "Inspection Report", "property,unit,inspection_date,inspector,condition,damage,required_repairs,estimated_cost,photos_reference"),
            _document("property_management.vendor_invoice", "Vendor Invoice", "vendor,property,invoice_number,invoice_date,service,labor,materials,tax,total,payment_status"),
            _document("property_management.property_insurance", "Property Insurance", "property,insurer,policy_number,effective_date,expiration_date,coverage,deductible,premium"),
        ),
    ),
)


DOCUMENT_SCHEMAS = {
    document.key: (industry, document)
    for industry in INDUSTRIES
    for document in industry.document_types
}


def require_document_schema(document_type: str | None) -> DocumentSchema | None:
    if document_type is None or not document_type.strip():
        return None
    value = document_type.strip().lower()
    match = DOCUMENT_SCHEMAS.get(value)
    if match is None:
        raise ValueError("Unsupported document type")
    return match[1]


def schema_catalog() -> list[dict[str, object]]:
    return [
        {
            "key": industry.key,
            "label": industry.label,
            "description": industry.description,
            "document_types": [
                {"key": document.key, "label": document.label, "fields": list(document.fields)}
                for document in industry.document_types
            ],
        }
        for industry in INDUSTRIES
    ]
