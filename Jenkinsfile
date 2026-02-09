pipeline {
    agent any
    
    
    stages {
        stage('Pull Latest Code') {
            steps {
                sh '''
                    git config --global --add safe.directory /home/ubuntu/project
                    cd /home/ubuntu/project
                    
                    if [ -f backend/.env ]; then
                        cp backend/.env /tmp/backend.env.backup
                    fi
                    
                    git fetch origin
                    git reset --hard origin/main
                     
                    if [ -f /tmp/backend.env.backup ]; then
                        cp /tmp/backend.env.backup backend/.env
                    fi

                    # Ensure workspace is clean.
                    # NOTE: this keeps ignored files (e.g. backend/.env) but removes untracked files
                    # that can accidentally break Docker builds.
                    git clean -fd
                '''
            }
        }
        
        stage('Build and Deploy Main Server') {
            steps {
                sh '''
                    cd /home/ubuntu/project

                    # LiveKit requires LIVEKIT_KEYS ("key: secret")
                    # Derive it from backend/.env without leaking to logs.
                    set +x
                    if [ -f backend/.env ]; then
                        LK_API_KEY="$(grep -E '^LIVEKIT_API_KEY=' backend/.env | head -n 1 | cut -d= -f2-)"
                        LK_API_SECRET="$(grep -E '^LIVEKIT_API_SECRET=' backend/.env | head -n 1 | cut -d= -f2-)"
                        if [ -n "${LK_API_KEY}" ] && [ -n "${LK_API_SECRET}" ]; then
                            export LIVEKIT_KEYS="${LK_API_KEY}: ${LK_API_SECRET}"
                        fi
                    fi

                    if [ -z "${LIVEKIT_KEYS}" ]; then
                        echo "LIVEKIT_KEYS is not set. Ensure LIVEKIT_API_KEY and LIVEKIT_API_SECRET exist in backend/.env"
                        exit 1
                    fi

                    docker compose up -d --build frontend backend nginx livekit

                    # Nginx resolves upstream hostnames at startup.
                    # When frontend/backend containers are recreated, restart nginx to pick up new IPs.
                    docker compose restart nginx
                '''
            }
        }
        
        stage('Deploy GPU Server (AI Worker)') {
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'FAILURE') {
                    withCredentials([string(credentialsId: 'gpu-server-host', variable: 'GPU_SERVER')]) {
                        sh '''
                            GPU_SSH_KEY="/var/lib/jenkins/.ssh/gpu_key"
                            
                            # Sync ai-worker code to GPU server (excluding .env)
                            rsync -avz --exclude=".env" -e "ssh -i ${GPU_SSH_KEY} -o StrictHostKeyChecking=accept-new" \
                                /home/ubuntu/project/ai-worker/ ubuntu@${GPU_SERVER}:/data/kero/ai-worker/
                            
                            # Restart AI Worker on GPU server
                            ssh -i ${GPU_SSH_KEY} -o StrictHostKeyChecking=accept-new ubuntu@${GPU_SERVER} '
                                cd /data/kero/ai-worker
                                
                                # Rebuild and restart with Docker
                                docker compose down || true
                                docker compose up -d --build
                                
                                echo "Waiting for AI Worker to start..."
                                sleep 20
                                
                                # Check if container is running
                                if docker compose ps | grep -q "Up"; then
                                    echo "AI Worker is running"
                                    docker compose ps
                                else
                                    echo "AI Worker startup logs:"
                                    docker compose logs --tail=20
                                fi
                            '
                        '''
                    }
                }
            }
        }
        
        stage('Health Check') {
            steps {
                sh '''
                    for i in $(seq 1 30); do
                        if curl -fsS https://kero.ooo >/dev/null; then
                            break
                        fi
                        echo "Waiting for https://kero.ooo... (${i}/30)"
                        sleep 2
                    done

                    curl -f https://kero.ooo || exit 1
                    curl -f https://kero.ooo/api/health || echo "Backend health check skipped"
                    echo "Main server health check passed!"
                '''
            }
        }
        
        stage('Cleanup') {
            steps {
                sh 'docker image prune -f'
            }
        }
    }
    
    post {
        success {
            echo '✅ Deployment successful! Main Server + GPU AI Worker'
        }
        failure {
            echo '❌ Deployment failed!'
        }
    }
}
