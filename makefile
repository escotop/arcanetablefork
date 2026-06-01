docker_container = ghcr.io/odama626/arcanetable
github_repo = "org.opencontainers.image.source=https://github.com/odama626/arcanetable"
# ---- build metadata ----
export GIT_SHA        := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
export GIT_SHA_FULL   := $(shell git rev-parse HEAD 2>/dev/null || echo unknown)
export GIT_DIRTY      := $(shell git diff --quiet || echo -dirty)
export BUILD_DATE     := $(shell date -u +"%Y-%m-%dT%H.%M.%SZ")
export BUILD_ID       := $(GIT_SHA)$(GIT_DIRTY)
export BUILD_VERSION  := $(BUILD_DATE)-$(BUILD_ID)
# Vite-exposed env vars
export VITE_APP_NAME     = Arcanetable
export VITE_BUILD_ID     = $(BUILD_VERSION)
export VITE_GIT_SHA      = $(GIT_SHA)
export VITE_GIT_SHA_FULL = $(GIT_SHA_FULL)
export VITE_BUILD_DATE   = $(BUILD_DATE)
export VITE_BUILD_ENV    = production

build:
	pnpm build
	docker build . \
		--label $(github_repo) \
		-t $(docker_container):latest \
		-t $(docker_container):$(BUILD_ID) \
		-t $(docker_container):$(BUILD_DATE) \
		-t $(docker_container):beta \
		-t $(docker_container):staging
		
	$(MAKE) -C yjs-signaling-server build
	$(MAKE) -C websocket-server build
	$(MAKE) -C scry-server-mtg build
	$(MAKE) -C scry-server-yugioh build
	$(MAKE) -C scry-server-pokemon build
	
push: build
	docker push $(docker_container):latest
	docker push $(docker_container):$(BUILD_ID)
	docker push $(docker_container):$(BUILD_DATE)
	docker push $(docker_container):beta
	docker push $(docker_container):staging

	$(MAKE) -C yjs-signaling-server push
	$(MAKE) -C websocket-server push
	$(MAKE) -C scry-server-mtg push
	$(MAKE) -C scry-server-yugioh push
	$(MAKE) -C scry-server-pokemon push

deploy: build push
	$(MAKE) -C scry-server-mtg apply
	$(MAKE) -C scry-server-yugioh apply
	$(MAKE) -C scry-server-pokemon apply
	kubectl apply -f secrets.yml -f deployment.yml -f staging.yaml
	kubectl rollout restart deployment -n arcanetable
	
promote_staging:
	docker pull $(docker_container):staging
	docker tag $(docker_container):staging $(docker_container):production
	docker tag $(docker_container):staging $(docker_container):stable
	
	docker push $(docker_container):production
	docker push $(docker_container):stable
	docker push $(docker_container):staging
	
	kubectl apply -f secrets.yml -f deployment.yml
	kubectl rollout restart deployment -n arcanetable
