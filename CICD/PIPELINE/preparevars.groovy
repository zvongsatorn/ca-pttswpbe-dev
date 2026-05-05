def globalVariable(envName){
    // !!!!----------------------------------------!!!! //
    // !!!!------------- Start to edit ------------!!!! //
    // !!!!----------------------------------------!!!! //
    env.project_group       = "do69002-swp"
    env.project_name        = "pttswpbe"
    env.project_version     = "1.0"

    env.application_language    = [ "python": false, "nodejs": true, "golang": false, "dotnet_core": false, "java": false, "php": false, "dotnet_fw": false ]
    env.deploy_type             = [ "oc": false, "aks": false, "aws": false, "azure_function": false, "appservice_srccode": false, "appservice_container": false, "aca": true ]
    env.unit_test_base_image    = ""
    env.automate_test           = [ "api_test" : true, "ui_test" : false ]
    env.allow_failure           = [ "trivy" : false, "sonarqube" : false, "blackduck" : false, "owasp" : false, "owasp_zap"  : false , "coverity" : false , "performance_test" : false, "api_test" : false, "ui_test" : true]
    env.build_cmd               = ""
    env.coverityID              = "cov-user07"
    env.blkduckID               = "blkduck-user7"
    env.skip_stage              = [ "unit_test": false, "quality_analysis": false, "sca_black_duck": false, "sast_coverity": false, "image_scan_trivy": false, "dast_owasp_zap": false, "performance_test": false, "health_check_dev": false, "automate_test_dev": false, "health_check_sit": false, "automate_test_sit": false, "health_check_uat": false, "automate_test_uat": false, "health_check_prd": false]
    env.image_regitry_server    = [ "acr": true, "nexus": false, "ecr": false, "gar": false, "gcr": false ]
    env.container_os_platform   = [ "windows": false, "linux": true ]
    env.is_scan_src_code_only   = false
    env.is_build_with_internal_net = false
    env.time_sleep_before_health_check = 5
    env.coverity_version = [ "version2025": true ]

    // NPM Private Registry
    env.has_npm_private_reg     = false
    env.npm_private_reg_path    = ""
    env.npm_private_reg_token   = "${project_group}-npm-registry"

    // DEV
    url_env_1                 = "https://pttswpbedev.pttplc.com"
    url_path_env_1            = ""
    // SIT
    url_env_2                 = "https://pttswpbesit.pttplc.com"
    url_path_env_2            = ""
    // UAT
    url_env_3                 = "https://pttswpbeuat.pttplc.com"
    url_path_env_3            = ""
    // PRD
    url_env_4                 = ""
    url_path_env_4            = ""

    // Azure Config //
    //! Azure Container Registry //
    acr_credentials_cicd      = "${project_group}-asp"
    // DEV
    acr_server_env_1          = "acrpttswpdev.azurecr.io"
    // SIT
    acr_server_env_2          = "acrpttswpsit.azurecr.io"
    // UAT
    acr_server_env_3          = "acrpttswpuat.azurecr.io"
    // PRD
    acr_server_env_4          = ""
    //! End Azure Container Registry //

    //! Azure Container App Config //
    aca_credentials_cicd      = "${project_group}-asp"
    // DEV
    aca_name_env_1            = "ca-pttswpbe-dev"
    aca_rg_env_1              = "rg-hrspd-pttswp-dev-001"
    // SIT
    aca_name_env_2            = "ca-pttswpbe-sit"
    aca_rg_env_2              = "rg-hrspd-pttswp-sit-001"
    // UAT
    aca_name_env_3            = "ca-pttswpbe-uat"
    aca_rg_env_3              = "rg-hrspd-pttswp-uat-001"
    // PRD
    aca_name_env_4            = ""
    aca_rg_env_4              = ""


    // !!!!----------------------------------------!!!! //
    // !!!!-------------- End to edit -------------!!!! //
    // !!!!----------------------------------------!!!! //

    // !!!!----------------------------------------!!!! //
    // !!!!-------------- Do not edit -------------!!!! //
    // !!!!----------------------------------------!!!! //

    //! Azure key vault Config // 
    env.keyVault_url        = "https://kv-devsecops-prd-001.vault.azure.net/"
    env.keyVault_credential = "vault-creds-for-jenkins-ptt"
    //! End Azure key vault Config //
    
    env.coverity_version = [ "version2024kube" : true ]

    env.cicd_env_1 = "dev"
    env.cicd_env_2 = "sit"
    env.cicd_env_3 = "uat"
    env.cicd_env_4 = "prd"

    switch (env.BRANCH_NAME) {

        case "develop":
        case "hotfix":
            switch (envName) {
                case cicd_env_1 :
                    env.envName                   = cicd_env_1
                    // Azure Container App
                    env.aca_credentials           = "${aca_credentials_cicd}-${envName}"
                    env.aca_name                  = aca_name_env_1
                    env.aca_rg                    = aca_rg_env_1
                    // IMAGE
                    env.image_repo_server         = acr_server_env_1
                    env.image_credentials         = "${acr_credentials_cicd}-${cicd_env_1}"
                    env.image_name                = "${env.image_repo_server}/${project_group}/${project_name}"
                    // APP
                    env.url_application           = url_env_1
                    env.url_path                  = url_path_env_1
                    break
                case cicd_env_2:
                    env.envName                   = cicd_env_2
                    // Azure Container App
                    env.aca_credentials           = "${aca_credentials_cicd}-${envName}"
                    env.aca_name                  = aca_name_env_2
                    env.aca_rg                    = aca_rg_env_2
                    // IMAGE
                    env.image_prev_repo_server    = acr_server_env_1
                    env.image_prev_credentials    = "${acr_credentials_cicd}-${cicd_env_1}"
                    env.image_repo_server         = acr_server_env_2
                    env.image_credentials         = "${acr_credentials_cicd}-${cicd_env_2}"
                    env.image_prev_name           = "${env.image_prev_repo_server}/${project_group}/${project_name}"
                    env.image_name                = "${env.image_repo_server}/${project_group}/${project_name}"
                    // APP
                    env.url_application           = url_env_2
                    env.url_path                  = url_path_env_2
                    break
            }
        case "hotfix":
        case "hotfix-deploy":
        case "master":
        case "main":
            switch (envName) {
                case cicd_env_3:
                    env.envName                   = cicd_env_3
                    // Azure Container App
                    env.aca_credentials           = "${aca_credentials_cicd}-${envName}"
                    env.aca_name                  = aca_name_env_3
                    env.aca_rg                    = aca_rg_env_3
                    // IMAGE
                    env.image_prev_repo_server    = acr_server_env_2
                    env.image_prev_credentials    = "${acr_credentials_cicd}-${cicd_env_2}"
                    env.image_repo_server         = acr_server_env_3
                    env.image_credentials         = "${acr_credentials_cicd}-${cicd_env_3}"
                    env.image_prev_name           = "${env.image_prev_repo_server}/${project_group}/${project_name}"
                    env.image_name                = "${env.image_repo_server}/${project_group}/${project_name}"
                    // APP
                    env.url_application           = url_env_3
                    env.url_path                  = url_path_env_3
                    break
                case cicd_env_4:
                    env.envName                   = cicd_env_4
                    // Azure Container App
                    env.aca_credentials           = "${aca_credentials_cicd}-${envName}"
                    env.aca_name                  = aca_name_env_4
                    env.aca_rg                    = aca_rg_env_4
                    // IMAGE
                    env.image_prev_repo_server    = acr_server_env_3
                    env.image_prev_credentials    = "${acr_credentials_cicd}-${cicd_env_3}"
                    env.image_repo_server         = acr_server_env_4
                    env.image_credentials         = "${acr_credentials_cicd}-${cicd_env_4}"
                    env.image_prev_name           = "${env.image_prev_repo_server}/${project_group}/${project_name}"
                    env.image_name                = "${env.image_repo_server}/${project_group}/${project_name}"
                    // APP
                    env.url_application           = url_env_4
                    env.url_path                  = url_path_env_4
                    break
            }
    }
}

return this